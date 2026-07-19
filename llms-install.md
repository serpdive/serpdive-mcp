# Installing the SERPdive MCP server (guide for AI agents)

Two ways to connect. Prefer the hosted server when the client supports remote MCP.

## Option A: hosted server (no install)

Add a remote MCP server with:

- URL: `https://mcp.serpdive.com` (Streamable HTTP; `/mcp` also works)
- Auth: HTTP header `Authorization: Bearer <SERPDIVE_API_KEY>`, or append
  `?key=<SERPDIVE_API_KEY>` to the URL if the client only accepts a URL.

## Option B: local stdio server (npx)

Requirements: Node.js >= 18. No other dependencies (the package has none).

Add this to the client's MCP configuration:

```json
{
  "mcpServers": {
    "serpdive": {
      "command": "npx",
      "args": ["-y", "serpdive-mcp"],
      "env": { "SERPDIVE_API_KEY": "sd_live_..." }
    }
  }
}
```

## API key

The user needs a SERPdive API key (starts with `sd_live_`). Free at
https://serpdive.com/dashboard/keys, no card required. If no key is configured,
the server still starts and the tool replies with instructions instead of
results, so the connection itself never fails.

## Verify

Call the `serpdive_search` tool with `{"query": "test"}`: a JSON payload with
a `results` array confirms everything works. Errors come back as readable
text (invalid key, quota, rate limit) with the action to take.
