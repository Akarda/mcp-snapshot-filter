/**
 * Convert CDP Accessibility.getFullAXTree() response into the indented text
 * format that chrome-devtools-mcp produces and our filters expect.
 *
 * Output format:
 *   uid=1_0 RootWebArea "Page Title"
 *     uid=1_1 navigation "Main Nav"
 *       uid=1_2 link "Home"
 *       uid=1_3 textbox "Search": "current value"
 */

interface AXNode {
  nodeId: string;
  ignored?: boolean;
  ignoredReasons?: unknown[];
  role?: { type: string; value: string };
  name?: { type: string; value: string };
  description?: { type: string; value: string };
  value?: { type: string; value: unknown };
  properties?: Array<{ name: string; value: { type: string; value: unknown } }>;
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

interface FormatResult {
  text: string;
  nodeCount: number;
}

/** Properties worth including in the output (matches chrome-devtools-mcp behavior) */
const USEFUL_PROPERTIES = new Set([
  "checked",
  "disabled",
  "expanded",
  "level",
  "pressed",
  "selected",
  "required",
  "invalid",
  "modal",
  "orientation",
  "readonly",
  "valuemin",
  "valuemax",
  "valuetext",
  "autocomplete",
  "haspopup",
  "multiselectable",
  "multiline",
]);

export function formatAccessibilityTree(nodes: AXNode[]): FormatResult {
  // Build a lookup map by nodeId
  const nodeMap = new Map<string, AXNode>();
  for (const node of nodes) {
    nodeMap.set(node.nodeId, node);
  }

  // Find root nodes (no parentId or parentId not in the set)
  const roots: AXNode[] = [];
  for (const node of nodes) {
    if (!node.parentId || !nodeMap.has(node.parentId)) {
      roots.push(node);
    }
  }

  const lines: string[] = [];
  let counter = 0;
  let nodeCount = 0;

  function walk(node: AXNode, depth: number): void {
    // Skip ignored nodes (same behavior as chrome-devtools-mcp)
    if (node.ignored) {
      // Still walk children — they may not be ignored
      if (node.childIds) {
        for (const childId of node.childIds) {
          const child = nodeMap.get(childId);
          if (child) walk(child, depth);
        }
      }
      return;
    }

    const role = node.role?.value || "unknown";
    const name = node.name?.value || "";
    const uid = `1_${counter++}`;
    const indent = "  ".repeat(depth);

    // Build the line: uid=X role "name": "value" key=val ...
    let line = `${indent}uid=${uid} ${role}`;

    // Name
    if (name) {
      line += ` "${name}"`;
    }

    // Value (inputs, textboxes, cells with editable content, sliders, etc.)
    const value = node.value?.value;
    if (value !== undefined && value !== "" && value !== name) {
      const valStr = typeof value === "string" ? value : String(value);
      if (valStr) {
        line += `: "${valStr}"`;
      }
    }

    // Description (additional context, e.g. aria-describedby)
    const desc = node.description?.value;
    if (desc) {
      line += ` description="${desc}"`;
    }

    // Extra properties (checked, level, expanded, etc.)
    if (node.properties) {
      for (const prop of node.properties) {
        if (!USEFUL_PROPERTIES.has(prop.name)) continue;
        const v = prop.value?.value;
        if (v === undefined || v === false || v === "false") continue;
        if (v === true || v === "true") {
          line += ` ${prop.name}`;
        } else {
          line += ` ${prop.name}=${v}`;
        }
      }
    }

    lines.push(line);
    nodeCount++;

    // Recurse into children
    if (node.childIds) {
      for (const childId of node.childIds) {
        const child = nodeMap.get(childId);
        if (child) walk(child, depth + 1);
      }
    }
  }

  for (const root of roots) {
    walk(root, 0);
  }

  return { text: lines.join("\n"), nodeCount };
}
