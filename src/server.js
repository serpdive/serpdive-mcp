/**
 * serpdive-mcp — local MCP server (stdio) for SERPdive.
 *
 * The stdio twin of the hosted server at https://mcp.serpdive.com: same single
 * tool, same descriptions, same behavior. It talks to the public API directly
 * (POST api.serpdive.com/v1/search) with the key from SERPDIVE_API_KEY, so
 * requests leave from the user's own machine and localization stays theirs.
 *
 * Zero dependencies: MCP over stdio is newline-delimited JSON-RPC, and the API
 * is one fetch. Logs go to stderr only; stdout carries protocol messages and
 * nothing else.
 */

import { createInterface } from 'node:readline';

export const VERSION = '0.1.1';

const API_URL = 'https://api.serpdive.com/v1/search';

const SERVER_INFO = { name: 'serpdive', title: 'SERPdive Web Search', version: VERSION };

// Newest first. initialize echoes the client's version when we support it,
// otherwise answers with our newest (per spec) and lets the client decide.
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// Guidance the client may inject into the model's system prompt.
const INSTRUCTIONS =
  'SERPdive is real-time web search built for AI agents: results are extracted, ' +
  'answer-ready page content, not links. Call serpdive_search whenever the task ' +
  'needs current or post-training information. Pass the query in any language; ' +
  'localization is automatic.';

// The tool the LLM sees. The description is the product pitch AND the usage
// manual in one paragraph — the model decides when to call us based on it.
export const TOOL = {
  name: 'serpdive_search',
  title: 'SERPdive Web Search',
  description:
    'Search the live web and get back answer-ready page content, not a list of links. ' +
    'Each result carries the actual text of the page (url, title, date, content), already ' +
    'extracted, cleaned and trimmed for LLM use, so facts can be quoted and cited straight ' +
    'from the response. Use it for anything that needs current or post-training information: ' +
    'news, prices, releases, docs, sports, niche facts. Write the query the way a person ' +
    'would type it, in any language: localization is automatic. ' +
    "The 'mako' model (default) returns the fact-carrying sentences of each page, fast and " +
    "concise, right for most questions. The 'moby' model returns the full readable text of " +
    'each page: use it for deep research or when complete context matters. ' +
    'Set answer=true to also get a direct answer synthesized from the sources.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query, in any language, phrased like a real web search.',
      },
      model: {
        type: 'string',
        enum: ['mako', 'moby'],
        description:
          "'mako' (default): the key sentences of each page, concise and fast. " +
          "'moby': the full readable text of each page, for deep research.",
      },
      answer: {
        type: 'boolean',
        description:
          "When true, the response also carries an 'answer' field: a direct answer " +
          'to the query synthesized from the sources.',
      },
      max_results: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description:
          'Maximum number of results to return (1 to 10). Omit to let the engine ' +
          'pick its calibrated mix.',
      },
    },
    required: ['query'],
  },
};

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

// Tool-execution failures are isError RESULTS, not protocol errors: the text
// reaches the LLM, which can relay it to the human or self-correct and retry.
const toolError = (text) => ({ content: [{ type: 'text', text }], isError: true });
const toolOk = (text) => ({ content: [{ type: 'text', text }] });

async function runSearch(args, key) {
  if (!key) {
    return toolError(
      'No SERPdive API key is configured. Set the SERPDIVE_API_KEY environment ' +
        'variable in this MCP server\'s config (the "env" block of the server entry). ' +
        'Create a free key at https://serpdive.com/dashboard/keys',
    );
  }
  const query = (args && typeof args.query === 'string' ? args.query : '').trim();
  if (!query) return toolError('The "query" argument is required: the web search to run, in any language.');

  // Only whitelisted, well-formed values travel — the MCP surface can never
  // become a side door to the API's undocumented knobs.
  const body = { query };
  if (args.model === 'mako' || args.model === 'moby') body.model = args.model;
  if (args.answer === true) body.answer = true;
  const cap = parseInt(args.max_results, 10);
  if (Number.isFinite(cap)) body.max_results = Math.min(Math.max(cap, 1), 10);

  let response, payload;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        'user-agent': `serpdive-mcp/${VERSION}`,
      },
      body: JSON.stringify(body),
      // Moby reads whole pages; 80 s is the documented client timeout.
      signal: AbortSignal.timeout(80_000),
    });
    payload = await response.json();
  } catch {
    return toolError('The search could not be completed (network error or timeout). The user was not billed. Please retry.');
  }
  if (!response.ok || (payload && payload.error)) {
    return toolError(
      payload && payload.message ? payload.message : 'The search failed. Please retry in a few seconds.',
    );
  }
  // The API's JSON ships verbatim, compact — tokens are the product, and the
  // shape is already the one the docs and playground advertise.
  return toolOk(JSON.stringify(payload));
}

/** Handle one JSON-RPC message. Returns the reply, or null for notifications. */
export async function handleMessage(msg, { key } = {}) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return msg && msg.id !== undefined ? rpcError(msg.id, -32600, 'Invalid request') : null;
  }
  const { id, method, params } = msg;
  // Notifications (no id) never get a reply, whatever the method.
  if (id === undefined || method.startsWith('notifications/')) return null;

  switch (method) {
    case 'initialize': {
      const wanted = params && params.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.includes(wanted) ? wanted : PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: [TOOL] });
    case 'tools/call': {
      const name = params && params.name;
      if (name !== TOOL.name) return rpcError(id, -32602, `Unknown tool: ${name}`);
      return rpcResult(id, await runSearch((params && params.arguments) || {}, key));
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

/** The stdio loop: newline-delimited JSON-RPC on stdin/stdout. */
export function runStdio() {
  const key = (process.env.SERPDIVE_API_KEY || '').trim();
  if (!key) {
    // Not fatal: the server must still start so the client can connect and the
    // LLM can surface the actionable message from tools/call.
    process.stderr.write('serpdive-mcp: SERPDIVE_API_KEY is not set — searches will fail until it is.\n');
  }
  const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      out(rpcError(null, -32700, 'Parse error: each line must be one JSON-RPC message'));
      return;
    }
    // Batches (older clients may send them): answer each request in order.
    const messages = Array.isArray(msg) ? msg : [msg];
    Promise.all(messages.map((m) => handleMessage(m, { key }))).then((replies) => {
      const real = replies.filter(Boolean);
      if (!real.length) return;
      if (Array.isArray(msg)) out(real);
      else out(real[0]);
    });
  });
  rl.on('close', () => process.exit(0));
}
