/**
 * A section of a markdown-formatted MCP response.
 * Sections are delimited by ## headers.
 */
export interface ResponseSection {
  header: string; // The ## header text, e.g., "Latest page snapshot"
  content: string; // Everything after the header until the next ## or end
  startIndex: number; // Character index in the original text where this section starts
  endIndex: number; // Character index where this section ends
}

/**
 * Parse a markdown-sectioned MCP response text into sections.
 *
 * Typical sections from chrome-devtools-mcp:
 * - "Latest page snapshot" (a11y tree - main filtering target)
 * - "Network requests" (request list)
 * - "Console messages" (console output)
 * - "Page info" (URL, title metadata)
 * - Various others
 *
 * Text before the first ## header is treated as a preamble section with header "".
 */
export function parseResponse(text: string): ResponseSection[] {
  const sections: ResponseSection[] = [];
  const headerPattern = /^## (.+)$/gm;

  let lastIndex = 0;
  let lastHeader = "";
  let match: RegExpExecArray | null;

  while ((match = headerPattern.exec(text)) !== null) {
    // Save the previous section
    if (lastIndex < match.index) {
      const content = text.slice(lastIndex, match.index);
      if (content.trim() || lastHeader) {
        sections.push({
          header: lastHeader,
          content: content,
          startIndex: lastIndex,
          endIndex: match.index,
        });
      }
    }
    lastHeader = match[1];
    lastIndex = match.index + match[0].length + 1; // +1 for newline
  }

  // Capture the final section
  if (lastIndex < text.length) {
    sections.push({
      header: lastHeader,
      content: text.slice(lastIndex),
      startIndex: lastIndex,
      endIndex: text.length,
    });
  } else if (lastHeader && lastIndex === text.length) {
    // Header at the very end with no content
    sections.push({
      header: lastHeader,
      content: "",
      startIndex: lastIndex,
      endIndex: text.length,
    });
  }

  return sections;
}

/**
 * Reassemble sections back into a single text.
 */
export function assembleSections(sections: ResponseSection[]): string {
  return sections
    .map((s) => {
      if (s.header) {
        return `## ${s.header}\n${s.content}`;
      }
      return s.content;
    })
    .join("");
}
