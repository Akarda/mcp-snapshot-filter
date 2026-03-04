import type { FilterConfig } from "../config.js";

const MAX_PARSE_SIZE = 5 * 1024 * 1024; // 5MB — skip JSON.parse for huge strings
const CODE_FENCE_RE = /^```(?:\w*)\n([\s\S]*?)```$/;
const HTML_TAG_RE = /^\s*<[a-zA-Z][^>]*>/;

/**
 * Filter evaluate_script responses: truncate large JSON arrays, HTML dumps, or plain text.
 */
export function filterEvaluateScript(
  text: string,
  config: FilterConfig
): string {
  const { maxJsonArrayItems, maxTextLength } = config.evaluateFilter;

  // 1. Try JSON array truncation
  let jsonSource = text;
  const fenceMatch = text.match(CODE_FENCE_RE);
  if (fenceMatch) {
    jsonSource = fenceMatch[1];
  }

  if (jsonSource.length <= MAX_PARSE_SIZE && jsonSource.trimStart().startsWith("[")) {
    try {
      const parsed = JSON.parse(jsonSource);
      if (Array.isArray(parsed) && parsed.length > maxJsonArrayItems) {
        const kept = parsed.slice(0, maxJsonArrayItems);
        const truncated = JSON.stringify(kept, null, 2);
        const notice = `\n[cdp-filter-proxy: array truncated from ${parsed.length} to ${maxJsonArrayItems} items]`;
        return truncated + notice;
      }
    } catch {
      // Not valid JSON — fall through
    }
  }

  // 2. HTML detection — truncate at maxTextLength
  if (HTML_TAG_RE.test(text) && text.length > maxTextLength) {
    const truncated = text.slice(0, maxTextLength);
    return truncated + `\n[cdp-filter-proxy: HTML truncated from ${text.length} to ${maxTextLength} chars]`;
  }

  // 3. Plain text fallback — truncate at maxTextLength
  if (text.length > maxTextLength) {
    const truncated = text.slice(0, maxTextLength);
    return truncated + `\n[cdp-filter-proxy: text truncated from ${text.length} to ${maxTextLength} chars]`;
  }

  return text;
}
