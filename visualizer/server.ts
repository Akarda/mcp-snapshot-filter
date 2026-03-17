import express from "express";
import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import CDP from "chrome-remote-interface";
import { formatAccessibilityTree } from "./snapshot-formatter.js";
import { filterResponseText } from "../src/filters/index.js";
import { filterEvaluateScript } from "../src/filters/evaluate-filter.js";
import { getConfig, type FilterConfig } from "../src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3333", 10);
const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9333; // separate port so it doesn't clash with anything

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

let chromeProcess: ChildProcess | null = null;

function findChrome(): string {
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    "Chrome not found. Install Google Chrome or set CHROME_PATH env var."
  );
}

async function launchChrome(): Promise<void> {
  const chromePath = process.env.CHROME_PATH || findChrome();
  const userDataDir = join(homedir(), ".cdp-visualizer-profile");
  if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });

  console.log(`  Launching Chrome...`);
  console.log(`  Profile: ${userDataDir}`);

  chromeProcess = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], {
    stdio: "ignore",
    detached: false,
  });

  chromeProcess.on("exit", () => {
    chromeProcess = null;
  });

  // Wait for CDP to become available
  for (let i = 0; i < 30; i++) {
    try {
      await CDP.Version({ host: CDP_HOST, port: CDP_PORT });
      console.log(`  Chrome ready on port ${CDP_PORT}`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error("Chrome failed to start within 9 seconds");
}

/** Connect to a Chrome tab by ID — resolves the websocket URL from the target list */
async function connectToTab(tabId: string): Promise<CDP.Client> {
  const targets = await CDP.List({ host: CDP_HOST, port: CDP_PORT });
  const target = targets.find((t: { id: string }) => t.id === tabId);
  if (!target) throw new Error("Tab not found. Click the refresh button and try again.");
  return CDP({ host: CDP_HOST, port: CDP_PORT, target });
}

const app = express();
app.use(express.json());

// Serve the web UI
app.get("/", (_req, res) => {
  res.sendFile(join(__dirname, "index.html"));
});

// List open Chrome tabs
app.get("/api/tabs", async (_req, res) => {
  try {
    const targets = await CDP.List({ host: CDP_HOST, port: CDP_PORT });
    const pages = targets.filter((t: { type: string }) => t.type === "page");
    res.json(
      pages.map((t: { id: string; title: string; url: string }) => ({
        id: t.id,
        title: t.title,
        url: t.url,
      }))
    );
  } catch {
    res.status(502).json({
      error: "Chrome is not running. Restart the visualizer.",
    });
  }
});

// Navigate a tab to a URL
app.post("/api/navigate", async (req, res) => {
  const { tabId, url } = req.body;
  let client: CDP.Client | null = null;

  try {
    client = await connectToTab(tabId);
    const { Page } = client;
    await Page.enable();
    await Page.navigate({ url });
    await Page.loadEventFired();
    // Brief pause for JS rendering
    await new Promise((r) => setTimeout(r, 500));
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  } finally {
    if (client) {
      try { await client.close(); } catch { /* ignore */ }
    }
  }
});

// Capture snapshot from a Chrome tab
app.post("/api/snapshot", async (req, res) => {
  const { tabId } = req.body;
  let client: CDP.Client | null = null;

  try {
    client = await connectToTab(tabId);
    const { Accessibility, Page } = client;

    await Page.enable();

    // Get the full accessibility tree
    const { nodes } = await Accessibility.getFullAXTree();
    const { text: rawSnapshot, nodeCount } = formatAccessibilityTree(nodes);

    // Wrap in the same section format chrome-devtools-mcp uses
    const rawText = `## Latest page snapshot\n${rawSnapshot}`;

    // Run filters at each level
    const levels = ["light", "moderate", "aggressive"] as const;
    const filtered: Record<string, { text: string; chars: number }> = {};

    for (const level of levels) {
      const config: FilterConfig = getConfig(level);
      const result = filterResponseText(rawText, config);
      filtered[level] = { text: result, chars: result.length };
    }

    res.json({
      raw: { text: rawText, chars: rawText.length, nodes: nodeCount },
      filtered,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  } finally {
    if (client) {
      try { await client.close(); } catch { /* ignore */ }
    }
  }
});

// Evaluate JS expression on a Chrome tab
app.post("/api/evaluate", async (req, res) => {
  const { tabId, expression } = req.body;
  let client: CDP.Client | null = null;

  try {
    client = await connectToTab(tabId);
    const { Runtime } = client;

    await Runtime.enable();
    const evalResult = await Runtime.evaluate({
      expression,
      returnByValue: true,
    });

    if (evalResult.exceptionDetails) {
      const msg =
        evalResult.exceptionDetails.text ||
        evalResult.exceptionDetails.exception?.description ||
        "Evaluation error";
      res.status(400).json({ error: msg });
      return;
    }

    const value = evalResult.result.value;
    const rawText =
      value === undefined
        ? "undefined"
        : value === null
          ? "null"
          : typeof value === "object"
            ? JSON.stringify(value, null, 2)
            : String(value);

    const levels = ["light", "moderate", "aggressive"] as const;
    const filtered: Record<string, { text: string; chars: number }> = {};

    for (const level of levels) {
      const config: FilterConfig = getConfig(level);
      const result = filterEvaluateScript(rawText, config);
      filtered[level] = { text: result, chars: result.length };
    }

    res.json({
      raw: { text: rawText, chars: rawText.length },
      filtered,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
  }
});

// Graceful shutdown — kill our Chrome
function cleanup() {
  if (chromeProcess) {
    console.log("\n  Shutting down Chrome...");
    chromeProcess.kill();
    chromeProcess = null;
  }
  process.exit(0);
}

process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);

// Start
async function main() {
  await launchChrome();

  app.listen(PORT, () => {
    console.log(`\n  CDP Filter Visualizer running at http://localhost:${PORT}`);
    console.log(`  Chrome launched with its own profile (won't affect your regular Chrome)`);
    console.log(`  Press Ctrl+C to stop both the server and Chrome\n`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err.message);
  cleanup();
});
