export interface SnapshotNode {
  uid: string;
  role: string;
  name: string;
  attributes: string;
  depth: number;
  children: SnapshotNode[];
  rawLine: string;
}

/**
 * Parse an indentation-based a11y tree snapshot into a tree structure.
 *
 * Lines look like:
 *   uid=1_0 RootWebArea "Page Title"
 *     uid=1_1 navigation "Main Nav"
 *       uid=1_2 link "Home"
 *   [i] uid=1_3 image "Logo"
 *   [f] uid=1_4 link "Focused Link"
 */
export function parseSnapshot(text: string): SnapshotNode[] {
  const lines = text.split("\n");
  const roots: SnapshotNode[] = [];
  const stack: { node: SnapshotNode; depth: number }[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // Calculate indentation depth (2 spaces per level)
    const stripped = line.replace(/^(\s*)/, "");
    const indent = line.length - stripped.length;
    const depth = Math.floor(indent / 2);

    // Parse the line: optional markers like [i], [f], then uid=X role "name" rest
    const match = stripped.match(
      /^(?:\[[^\]]*\]\s*)*(?:uid=(\S+)\s+)?(\S+)(?:\s+"([^"]*)")?(.*)$/
    );
    if (!match) continue;

    const node: SnapshotNode = {
      uid: match[1] || "",
      role: match[2] || "",
      name: match[3] || "",
      attributes: match[4]?.trim() || "",
      depth,
      children: [],
      rawLine: line,
    };

    // Find parent: walk stack back to find depth - 1
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }

    stack.push({ node, depth });
  }

  return roots;
}

/**
 * Serialize a tree back to the indentation-based format.
 */
export function serializeSnapshot(nodes: SnapshotNode[], baseDepth = 0): string {
  const lines: string[] = [];

  function walk(node: SnapshotNode, depth: number): void {
    // Reconstruct the line with proper indentation
    const indent = "  ".repeat(depth);
    // If we have the original rawLine, re-indent it; otherwise rebuild
    const content = node.rawLine.trim();
    lines.push(indent + content);
    for (const child of node.children) {
      walk(child, depth + 1);
    }
  }

  for (const node of nodes) {
    walk(node, baseDepth);
  }

  return lines.join("\n");
}

/**
 * Count total nodes in a tree.
 */
export function countNodes(nodes: SnapshotNode[]): number {
  let count = 0;
  function walk(node: SnapshotNode): void {
    count++;
    for (const child of node.children) {
      walk(child);
    }
  }
  for (const node of nodes) {
    walk(node);
  }
  return count;
}

/**
 * Collect all UIDs from a tree.
 */
export function collectUids(nodes: SnapshotNode[]): Set<string> {
  const uids = new Set<string>();
  function walk(node: SnapshotNode): void {
    if (node.uid) uids.add(node.uid);
    for (const child of node.children) {
      walk(child);
    }
  }
  for (const node of nodes) {
    walk(node);
  }
  return uids;
}
