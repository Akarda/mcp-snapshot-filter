import { getConfig } from "./config.js";
import { startProxy } from "./proxy.js";

function parseArgs(argv: string[]): {
  filterLevel: string;
  upstreamCommand: string;
  upstreamArgs: string[];
} {
  let filterLevel = "moderate";
  const args = argv.slice(2); // skip node and script path
  let separatorIndex = args.indexOf("--");

  // Parse our flags (before --)
  const ourArgs = separatorIndex >= 0 ? args.slice(0, separatorIndex) : args;
  for (const arg of ourArgs) {
    const match = arg.match(/^--filter-level=(.+)$/);
    if (match) {
      filterLevel = match[1];
    }
  }

  // Everything after -- is the upstream command
  let upstreamCommand: string;
  let upstreamArgs: string[];

  if (separatorIndex >= 0) {
    const upstream = args.slice(separatorIndex + 1);
    if (upstream.length === 0) {
      fail("No upstream command specified after --");
    }
    upstreamCommand = upstream[0];
    upstreamArgs = upstream.slice(1);
  } else {
    // Default: npx -y chrome-devtools-mcp@latest
    upstreamCommand = "npx";
    upstreamArgs = ["-y", "chrome-devtools-mcp@latest"];
  }

  return { filterLevel, upstreamCommand, upstreamArgs };
}

function fail(msg: string): never {
  process.stderr.write(`[cdp-filter-proxy] Error: ${msg}\n`);
  process.stderr.write(
    `Usage: node dist/index.js [--filter-level=off|light|moderate|aggressive] [-- <upstream-command> <args...>]\n`
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const { filterLevel, upstreamCommand, upstreamArgs } = parseArgs(
    process.argv
  );
  const config = getConfig(filterLevel);

  // Warn if upstream is running in --slim mode (proxy adds no value there)
  if (upstreamArgs.some((a) => a === "--slim" || a.startsWith("--slim="))) {
    process.stderr.write(
      `[cdp-filter-proxy] Warning: upstream is running in --slim mode. ` +
        `The proxy has no effect in slim mode since it only exposes 3 tools ` +
        `(navigate, evaluate, screenshot) with minimal responses.\n`
    );
  }

  process.stderr.write(
    `[cdp-filter-proxy] Starting with filter level: ${config.filterLevel}\n`
  );
  process.stderr.write(
    `[cdp-filter-proxy] Upstream: ${upstreamCommand} ${upstreamArgs.join(" ")}\n`
  );

  await startProxy({
    config,
    upstreamCommand,
    upstreamArgs,
  });
}

main().catch((err) => {
  process.stderr.write(`[cdp-filter-proxy] Fatal error: ${err}\n`);
  process.exit(1);
});
