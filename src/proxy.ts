import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { FilterConfig } from "./config.js";
import { filterResponseText } from "./filters/index.js";
import { filterEvaluateScript } from "./filters/evaluate-filter.js";

/** Tools whose responses should be filtered */
const FILTERABLE_TOOLS = new Set([
  "take_snapshot",
  "click",
  "fill",
  "fill_form",
  "hover",
  "press_key",
  "navigate_page",
  "list_network_requests",
  "list_console_messages",
  "drag",
  "upload_file",
  "select_page",
  "wait_for",
  "evaluate_script",
]);

export interface ProxyOptions {
  config: FilterConfig;
  upstreamCommand: string;
  upstreamArgs: string[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  return `${(kb / 1024).toFixed(1)}MB`;
}

export async function startProxy(options: ProxyOptions): Promise<void> {
  const { config, upstreamCommand, upstreamArgs } = options;

  // Session-level stats
  let totalOriginal = 0;
  let totalFiltered = 0;
  let filterCount = 0;

  // Create upstream client transport (spawns chrome-devtools-mcp)
  const upstreamTransport = new StdioClientTransport({
    command: upstreamCommand,
    args: upstreamArgs,
    stderr: "inherit",
  });

  // Create upstream client
  const upstream = new Client(
    { name: "cdp-filter-proxy", version: "1.0.0" },
    { capabilities: {} }
  );

  // Create our proxy server (low-level Server, not McpServer)
  const server = new Server(
    { name: "cdp-filter-proxy", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // Connect to upstream
  await upstream.connect(upstreamTransport);
  log(`Connected to upstream: ${upstreamCommand} ${upstreamArgs.join(" ")}`);

  // Discover upstream tools
  const upstreamTools = await upstream.listTools();
  log(`Discovered ${upstreamTools.tools.length} tools, filter level: ${config.filterLevel}`);

  // Handler: list tools - proxy upstream tools as-is
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: upstreamTools.tools };
  });

  // Handler: call tool - proxy call, filter response if applicable
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const toolArgs = request.params.arguments ?? {};

    const result = await upstream.callTool({
      name: toolName,
      arguments: toolArgs,
    });

    if (config.filterLevel === "off") return result;
    if (result.isError) return result;
    if (!FILTERABLE_TOOLS.has(toolName)) return result;

    if (result.content && Array.isArray(result.content)) {
      const filteredContent = (result.content as ContentBlock[]).map((block) => {
        if (block.type === "text" && typeof block.text === "string") {
          const originalLen = block.text.length;
          const filtered = toolName === "evaluate_script"
            ? filterEvaluateScript(block.text, config)
            : filterResponseText(block.text, config);
          const filteredLen = filtered.length;
          const saved = originalLen - filteredLen;

          if (saved <= 0) return { ...block, text: filtered };

          totalOriginal += originalLen;
          totalFiltered += filteredLen;
          filterCount++;

          const pct = ((saved / originalLen) * 100).toFixed(0);
          const totalSaved = totalOriginal - totalFiltered;
          const totalPct = ((totalSaved / totalOriginal) * 100).toFixed(0);
          const statsLine = `\n[cdp-filter-proxy: ${formatBytes(saved)} saved (${pct}%) | session: ${formatBytes(totalSaved)} saved across ${filterCount} calls (${totalPct}%)]`;

          return { ...block, text: filtered + statsLine };
        }
        return block;
      });

      return { ...result, content: filteredContent };
    }

    return result;
  });

  // Create server transport (stdio to Claude Code)
  const serverTransport = new StdioServerTransport();

  // Handle shutdown
  const cleanup = async () => {
    await upstream.close();
    await server.close();
    process.exit(0);
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  // Start the server
  await server.connect(serverTransport);
}

interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

function log(msg: string): void {
  process.stderr.write(`[cdp-filter-proxy] ${msg}\n`);
}
