import type { FilterConfig } from "../config.js";

/**
 * Filter console message list text.
 * Console messages from chrome-devtools-mcp look like:
 *
 * msgid=1 log "some message"
 * msgid=2 error "error message"
 * msgid=3 debug "debug info"
 * ...
 */
export function filterConsoleMessages(
  text: string,
  config: FilterConfig
): string {
  if (config.filterLevel === "off") return text;

  const lines = text.split("\n");
  const filtered: string[] = [];
  const stripTypes = new Set(
    config.consoleFilter.stripTypes.map((t) => t.toLowerCase())
  );
  let strippedCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Try to detect message type from the line
    // Format is typically: msgid=N type "message" or similar
    const lowerLine = trimmed.toLowerCase();
    let shouldStrip = false;

    for (const stripType of stripTypes) {
      // Match type after msgid or as a standalone word
      if (
        lowerLine.includes(` ${stripType} `) ||
        lowerLine.includes(`\t${stripType} `) ||
        lowerLine.includes(`\t${stripType}\t`)
      ) {
        shouldStrip = true;
        strippedCount++;
        break;
      }
    }

    if (!shouldStrip) {
      filtered.push(line);
    }

    if (filtered.length >= config.consoleFilter.maxMessages) {
      const remaining = lines.filter((l) => l.trim()).length - filtered.length;
      if (remaining > 0) {
        filtered.push(
          `\n... [${remaining} more console messages truncated, showing first ${config.consoleFilter.maxMessages}]`
        );
      }
      break;
    }
  }

  if (strippedCount > 0) {
    filtered.push(
      `\n[Filtered out ${strippedCount} console messages (types: ${[...stripTypes].join(", ")})]`
    );
  }

  return filtered.join("\n");
}
