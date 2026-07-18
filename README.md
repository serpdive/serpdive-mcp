# SERPdive MCP Server

Give any MCP client real-time web search with answer-ready results. [SERPdive](https://serpdive.com) is the AI Search API: ask a question, get the actual content of the best pages, extracted, cleaned, and sized for an LLM. On a [public, replayable 1,000-question benchmark](https://github.com/edendalexis/serpdive-benchmark), SERPdive runs at the same speed as Tavily, feeds your LLM 20.2% fewer tokens, and wins 60.7% of decided quality duels.

One tool, `serpdive_search`. Two ways to run it:

- **Hosted (recommended)**: `https://mcp.serpdive.com`, nothing to install.
- **Local (this package)**: `npx -y serpdive-mcp`, stdio, zero dependencies.

Get a free API key at [serpdive.com/dashboard/keys](https://serpdive.com/dashboard/keys) (no card required).

## Hosted server

### Claude Code

```bash
claude mcp add --transport http serpdive https://mcp.serpdive.com \
  --header "Authorization: Bearer sd_live_YOUR_KEY"
```

### Cursor, Windsurf, and other JSON-config clients

```json
{
  "mcpServers": {
    "serpdive": {
      "url": "https://mcp.serpdive.com/?key=sd_live_YOUR_KEY"
    }
  }
}
```

Both `https://mcp.serpdive.com/` and `https://mcp.serpdive.com/mcp` answer, so either URL shape works.

## Local server (npx)

### Claude Desktop

Add to `claude_desktop_config.json` (Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "serpdive": {
      "command": "npx",
      "args": ["-y", "serpdive-mcp"],
      "env": { "SERPDIVE_API_KEY": "sd_live_YOUR_KEY" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add serpdive --env SERPDIVE_API_KEY=sd_live_YOUR_KEY -- npx -y serpdive-mcp
```

### Cursor / Windsurf

```json
{
  "mcpServers": {
    "serpdive": {
      "command": "npx",
      "args": ["-y", "serpdive-mcp"],
      "env": { "SERPDIVE_API_KEY": "sd_live_YOUR_KEY" }
    }
  }
}
```

## The tool

`serpdive_search(query, model?, answer?, max_results?)`

| Argument | Type | Description |
|---|---|---|
| `query` | string, required | The search, in any language. Localization is automatic. |
| `model` | `"mako"` \| `"moby"` | `mako` (default): the fact-carrying sentences of each page, fast. `moby`: the full readable text of each page, for deep research. |
| `answer` | boolean | Also return a direct answer synthesized from the sources. |
| `max_results` | integer, 1-10 | Cap on delivered results. Omit for the engine's calibrated mix. |

The response is the raw SERPdive JSON: `query`, `model`, `response_time_ms`, optional `answer`, optional `extra_info`, and `results` as `[{ url, title, date?, content }]`. Failed searches are never billed.

## Pricing and limits

A `mako` search costs 1 credit, `moby` 1.5. Every account gets free monthly credits, no card required. Full reference: [serpdive.com/docs](https://serpdive.com/docs).

## License

MIT
