# mcp-snapshot-filter

MCP proxy that sits between [Claude Code](https://claude.com/claude-code) and [`chrome-devtools-mcp`](https://github.com/nichochar/chrome-devtools-mcp), intercepting content-heavy responses and applying smart filtering to reduce token usage by **40-60%**.

```
Claude Code  <--stdio-->  mcp-snapshot-filter  <--stdio-->  chrome-devtools-mcp
```

## Why?

Browser MCP tools (especially `take_snapshot`) return massive accessibility trees that fill up the context window fast. A single snapshot of a data-heavy page can be 30-40KB of text. This proxy transparently filters that down without breaking any tool interactions.

**Real-world results:**
| Page | Original | Filtered | Reduction |
|---|---|---|---|
| GitHub repo page | 29.5KB | 22.8KB | 23% |
| Portal with 36-row data table | 38.5KB | 17.3KB | 55% |

## Setup

```bash
# Clone and build
git clone https://github.com/Akarda/mcp-snapshot-filter.git
cd mcp-snapshot-filter
npm install
npm run build
```

Add to `~/.claude.json` (replace any existing `chrome-devtools` entry):

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/path/to/mcp-snapshot-filter/dist/index.js",
        "--filter-level=moderate",
        "--",
        "npx", "-y", "chrome-devtools-mcp@latest"
      ]
    }
  }
}
```

Restart Claude Code to pick up the new config.

## Filter Levels

| Setting | Light | Moderate (default) | Aggressive |
|---|---|---|---|
| maxNodes | 1000 | 500 | 300 |
| maxDepth | 20 | 15 | 10 |
| maxSimilarSiblings | 5 | 3 | 2 |
| Strip decorative nodes | yes | yes | yes |
| Collapse navigation | no | yes | yes |
| Focus main content only | no | no | yes |
| Est. reduction | 20-30% | 40-60% | 60-80% |

Use `--filter-level=off` to disable all filtering and pass through raw responses.

## What Gets Filtered

### Snapshot filtering (biggest impact)
- **Decorative nodes removed** — `role=none/presentation/separator`, empty text nodes, unnamed generic wrappers are stripped (children promoted up)
- **Similar siblings collapsed** — after N consecutive siblings with the same role (e.g., 50 `StaticText` nodes in a table), keeps first N and shows `... [47 more StaticText elements collapsed]`
- **Navigation collapsed** — `navigation/banner/contentinfo/menu` subtrees reduced to a single summary: `[navigation: 21 items, 9 links]`
- **Main content focus** (aggressive only) — when `role=main` exists, sibling subtrees are summarized
- **Depth/node limits** — prunes beyond maxDepth, caps total node count

### Network request filtering
Strips `image`, `font`, `stylesheet` (and `media` in aggressive) entries from `list_network_requests` output. All `xhr`, `fetch`, `document` requests remain visible. `get_network_request` is **never filtered** — individual request details always pass through in full.

### Console message filtering
Strips `debug`, `verbose` (and `dir`, `trace` at higher levels) from `list_console_messages`. Error and warning messages are always preserved.

## What Is NOT Filtered

- **Error responses** — always passed through raw
- **Image content blocks** — screenshots etc. are never touched
- **Unknown/new tools** — only explicitly listed tools get filtered, everything else passes through
- **Individual request/message details** — `get_network_request`, `get_console_message` are unfiltered
- **Non-snapshot tools** — `evaluate_script`, `emulate`, `performance_*`, etc. pass through as-is

## UID Integrity

All UIDs of visible nodes are preserved in filtered output. After taking a filtered snapshot, you can `click`, `fill`, or `hover` any UID shown in the output — the proxy forwards these calls to the upstream server unchanged.

## Session Stats

Each filtered response includes a stats line:
```
[cdp-filter-proxy: 20.7KB saved (55%) | session: 22.4KB saved across 2 calls (52%)]
```

## How It Works

The proxy uses the MCP SDK's low-level `Server` class (not `McpServer`) to avoid JSON Schema to Zod conversion issues when proxying tool definitions. On startup it:

1. Spawns the upstream `chrome-devtools-mcp` as a subprocess via `StdioClientTransport`
2. Discovers all upstream tools via `listTools()`
3. Re-exposes them via `setRequestHandler(ListToolsRequestSchema)` and `setRequestHandler(CallToolRequestSchema)`
4. For calls to content-heavy tools, parses the response text into markdown sections (`## Latest page snapshot`, etc.), applies the appropriate filter to each section, and returns the filtered result

## Development

```bash
npm run build    # compile TypeScript to dist/
```

After rebuilding, restart Claude Code to pick up changes (MCP servers are long-lived processes).
