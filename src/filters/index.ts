import type { FilterConfig } from "../config.js";
import { parseResponse, assembleSections } from "../parsers/response-parser.js";
import { filterSnapshot } from "./snapshot-filter.js";
import { filterNetworkList } from "./network-filter.js";
import { filterConsoleMessages } from "./console-filter.js";

/** Section headers that contain snapshot data */
const SNAPSHOT_HEADERS = [
  "latest page snapshot",
  "page snapshot",
  "snapshot",
];

const NETWORK_HEADERS = [
  "network requests",
  "requests",
];

const CONSOLE_HEADERS = [
  "console messages",
  "console",
];

function matchesAny(header: string, patterns: string[]): boolean {
  const lower = header.toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

/**
 * Apply all filters to a text content block from an MCP response.
 * Detects sections by their ## headers and applies the appropriate filter.
 */
export function filterResponseText(
  text: string,
  config: FilterConfig
): string {
  if (config.filterLevel === "off") return text;

  const sections = parseResponse(text);

  // If no sections found, try treating entire text as a snapshot
  // (some tools return raw snapshot without headers)
  if (sections.length <= 1 && !sections.some((s) => s.header)) {
    // Check if it looks like a snapshot (starts with uid= or indented uid=)
    if (text.trim().match(/^(?:\s*(?:\[[^\]]*\]\s*)*uid=)/)) {
      return filterSnapshot(text, config);
    }
    return text;
  }

  for (const section of sections) {
    if (!section.header) continue;

    if (matchesAny(section.header, SNAPSHOT_HEADERS)) {
      section.content = "\n" + filterSnapshot(section.content, config) + "\n\n";
    } else if (matchesAny(section.header, NETWORK_HEADERS)) {
      section.content =
        "\n" + filterNetworkList(section.content, config) + "\n\n";
    } else if (matchesAny(section.header, CONSOLE_HEADERS)) {
      section.content =
        "\n" + filterConsoleMessages(section.content, config) + "\n\n";
    }
    // Other sections pass through unchanged
  }

  return assembleSections(sections);
}
