import type { FilterConfig } from "../config.js";

/**
 * Filter network request list text.
 * Network lists from chrome-devtools-mcp typically look like:
 *
 * reqid=1 GET 200 document https://example.com/
 * reqid=2 GET 200 stylesheet https://example.com/style.css
 * reqid=3 GET 200 image https://example.com/logo.png
 * ...
 */
export function filterNetworkList(
  text: string,
  config: FilterConfig
): string {
  if (config.filterLevel === "off") return text;

  const lines = text.split("\n");
  const filtered: string[] = [];
  const strippedTypes = new Set(
    config.networkFilter.stripResourceTypes.map((t) => t.toLowerCase())
  );
  let strippedCount = 0;
  const strippedByType: Record<string, number> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try to detect resource type in the line
    // Lines typically contain the resource type as a word
    const lowerLine = trimmed.toLowerCase();
    let shouldStrip = false;

    for (const stripType of strippedTypes) {
      // Match resource type as a standalone word in the line
      if (
        lowerLine.includes(` ${stripType} `) ||
        lowerLine.includes(`\t${stripType}\t`) ||
        lowerLine.includes(`\t${stripType} `) ||
        lowerLine.includes(` ${stripType}\t`)
      ) {
        shouldStrip = true;
        strippedCount++;
        strippedByType[stripType] = (strippedByType[stripType] || 0) + 1;
        break;
      }
    }

    if (!shouldStrip) {
      filtered.push(line);
    }

    if (filtered.length >= config.networkFilter.maxRequests) {
      const remaining = lines.filter((l) => l.trim()).length - filtered.length;
      if (remaining > 0) {
        filtered.push(
          `\n... [${remaining} more requests truncated, showing first ${config.networkFilter.maxRequests}]`
        );
      }
      break;
    }
  }

  if (strippedCount > 0) {
    const typeSummary = Object.entries(strippedByType)
      .map(([type, count]) => `${count} ${type}`)
      .join(", ");
    filtered.push(`\n[Filtered out ${strippedCount} requests: ${typeSummary}]`);
  }

  return filtered.join("\n");
}
