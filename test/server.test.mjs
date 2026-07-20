// Unit tests for the stdio MCP server: protocol handshake, tool listing, tool
// calls with a stubbed fetch (auth, argument whitelisting, error mapping), and
// one end-to-end pass over the real stdio loop. node test/server.test.mjs
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { handleMessage, TOOL } from '../src/server.js';

let passed = 0;
const t = async (n, f) => { await f(); passed++; console.log(`  ✓ ${n}`); };

const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params });

await t('initialize echoes a known protocol version, downgrades unknown ones', async () => {
  let r = await handleMessage(rpc('initialize', { protocolVersion: '2025-03-26' }));
  assert.strictEqual(r.result.protocolVersion, '2025-03-26');
  assert.strictEqual(r.result.serverInfo.name, 'serpdive');
  r = await handleMessage(rpc('initialize', { protocolVersion: '1999-01-01' }));
  assert.strictEqual(r.result.protocolVersion, '2025-06-18');
});

await t('notifications are swallowed, unknown methods refused', async () => {
  assert.strictEqual(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const r = await handleMessage(rpc('logging/setLevel'));
  assert.strictEqual(r.error.code, -32601);
  // scanner probes get quiet empty lists, not warnings
  assert.deepStrictEqual((await handleMessage(rpc('resources/list'))).result, { resources: [] });
  assert.deepStrictEqual((await handleMessage(rpc('prompts/list'))).result, { prompts: [] });
});

await t('tools/list ships one tool with query required', async () => {
  const r = await handleMessage(rpc('tools/list'));
  assert.strictEqual(r.result.tools.length, 1);
  assert.strictEqual(r.result.tools[0].name, TOOL.name);
  assert.deepStrictEqual(r.result.tools[0].inputSchema.required, ['query']);
});

await t('tools/call without a key → isError pointing at SERPDIVE_API_KEY', async () => {
  const r = await handleMessage(rpc('tools/call', { name: TOOL.name, arguments: { query: 'x' } }), { key: '' });
  assert.strictEqual(r.result.isError, true);
  assert.match(r.result.content[0].text, /SERPDIVE_API_KEY/);
});

await t('tools/call happy path: auth header, whitelisted args, verbatim JSON', async () => {
  const product = { query: 'q', model: 'mako', response_time_ms: 900, results: [] };
  const realFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify(product));
  };
  try {
    const r = await handleMessage(
      rpc('tools/call', {
        name: TOOL.name,
        arguments: { query: 'q', model: 'nope', answer: true, max_results: 25, debug: 'k' },
      }),
      { key: 'sd_live_TEST' },
    );
    assert.strictEqual(seen.url, 'https://api.serpdive.com/v1/search');
    assert.strictEqual(seen.headers.authorization, 'Bearer sd_live_TEST');
    // invalid model dropped, cap clamped to 10, no side-door knobs. `answer: true`
    // is sent by the client above and must NOT survive: the knob is gone from the
    // schema, and a client asking for it anyway cannot re-enable it.
    assert.deepStrictEqual(seen.body, { query: 'q', max_results: 10 });
    assert.strictEqual(r.result.isError, undefined);
    assert.strictEqual(r.result.content[0].text, JSON.stringify(product));
  } finally {
    globalThis.fetch = realFetch;
  }
});

await t('API error surfaces its human message as isError', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'invalid_api_key', message: 'This API key is invalid or was revoked.' }), { status: 401 });
  try {
    const r = await handleMessage(rpc('tools/call', { name: TOOL.name, arguments: { query: 'q' } }), { key: 'sd_live_BAD' });
    assert.strictEqual(r.result.isError, true);
    assert.match(r.result.content[0].text, /invalid or was revoked/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await t('unknown tool → -32602, missing query → isError', async () => {
  let r = await handleMessage(rpc('tools/call', { name: 'other', arguments: { query: 'q' } }));
  assert.strictEqual(r.error.code, -32602);
  r = await handleMessage(rpc('tools/call', { name: TOOL.name, arguments: {} }), { key: 'k' });
  assert.strictEqual(r.result.isError, true);
});

await t('stdio end-to-end: initialize then tools/list over the real transport', async () => {
  const child = spawn(process.execPath, ['bin/serpdive-mcp.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, SERPDIVE_API_KEY: 'sd_live_TEST' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = [];
  let buffer = '';
  child.stdout.on('data', (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) { lines.push(JSON.parse(buffer.slice(0, i))); buffer = buffer.slice(i + 1); }
  });
  child.stdin.write(JSON.stringify(rpc('initialize', { protocolVersion: '2025-06-18' }, 1)) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  child.stdin.write(JSON.stringify(rpc('tools/list', undefined, 2)) + '\n');
  const deadline = Date.now() + 5000;
  while (lines.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  child.stdin.end();
  await once(child, 'exit');
  assert.strictEqual(lines.length, 2, 'two replies, none for the notification');
  assert.strictEqual(lines[0].id, 1);
  assert.strictEqual(lines[0].result.protocolVersion, '2025-06-18');
  assert.strictEqual(lines[1].id, 2);
  assert.strictEqual(lines[1].result.tools[0].name, 'serpdive_search');
});

console.log(`\n${passed} tests passed`);
