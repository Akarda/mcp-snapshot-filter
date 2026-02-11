import type { FilterConfig } from "../config.js";
import {
  type SnapshotNode,
  parseSnapshot,
  serializeSnapshot,
  countNodes,
} from "../parsers/snapshot-parser.js";

const DECORATIVE_ROLES = new Set([
  "none",
  "presentation",
  "separator",
  "LineBreak",
]);

const NAVIGATION_ROLES = new Set([
  "navigation",
  "banner",
  "contentinfo",
  "menu",
  "menubar",
  "complementary",
]);

/**
 * Apply all snapshot filtering strategies in order.
 */
export function filterSnapshot(
  snapshotText: string,
  config: FilterConfig
): string {
  if (config.filterLevel === "off") return snapshotText;

  let roots = parseSnapshot(snapshotText);

  if (config.stripDecorative) {
    roots = stripDecorativeNodes(roots);
  }

  if (config.collapseNavigation) {
    roots = collapseNavigationNodes(roots);
  }

  if (config.focusMainContent) {
    roots = focusMainContent(roots);
  }

  roots = collapseSimilarSiblings(roots, config.maxSimilarSiblings);

  roots = pruneByDepth(roots, config.maxDepth);

  const totalBefore = countNodes(roots);
  if (totalBefore > config.maxNodes) {
    roots = capNodeCount(roots, config.maxNodes);
  }

  return serializeSnapshot(roots);
}

/**
 * 1. Strip decorative nodes: role=none/presentation/separator, empty text nodes,
 *    unnamed generic wrappers. Promotes children up to parent.
 */
function stripDecorativeNodes(nodes: SnapshotNode[]): SnapshotNode[] {
  function process(node: SnapshotNode): SnapshotNode[] {
    // Recursively process children first
    const processedChildren: SnapshotNode[] = [];
    for (const child of node.children) {
      processedChildren.push(...process(child));
    }
    node.children = processedChildren;

    // Check if this node should be removed
    if (isDecorative(node)) {
      // Promote children, adjusting their depth
      return node.children;
    }

    return [node];
  }

  const result: SnapshotNode[] = [];
  for (const node of nodes) {
    result.push(...process(node));
  }
  return result;
}

function isDecorative(node: SnapshotNode): boolean {
  if (DECORATIVE_ROLES.has(node.role)) return true;

  // Empty text nodes
  if (node.role === "StaticText" && !node.name.trim()) return true;

  // Unnamed generic wrappers with children (promote children up)
  if (node.role === "generic" && !node.name && node.children.length > 0) {
    return true;
  }

  return false;
}

/**
 * 2. Collapse similar siblings: after N consecutive siblings with the same role,
 *    keep first N and insert a summary placeholder.
 */
function collapseSimilarSiblings(
  nodes: SnapshotNode[],
  maxSimilar: number
): SnapshotNode[] {
  function processChildren(children: SnapshotNode[]): SnapshotNode[] {
    if (children.length === 0) return children;

    // First, recursively process each child's own children
    for (const child of children) {
      child.children = processChildren(child.children);
    }

    const result: SnapshotNode[] = [];
    let i = 0;

    while (i < children.length) {
      const currentRole = children[i].role;
      let j = i;

      // Count consecutive siblings with the same role
      while (j < children.length && children[j].role === currentRole) {
        j++;
      }

      const runLength = j - i;

      if (runLength > maxSimilar) {
        // Keep first maxSimilar
        for (let k = i; k < i + maxSimilar; k++) {
          result.push(children[k]);
        }
        // Add a summary placeholder
        const collapsed = runLength - maxSimilar;
        const placeholder: SnapshotNode = {
          uid: "",
          role: "collapsed",
          name: `... [${collapsed} more ${currentRole} elements collapsed]`,
          attributes: "",
          depth: children[i].depth,
          children: [],
          rawLine: `... [${collapsed} more ${currentRole} elements collapsed]`,
        };
        result.push(placeholder);
      } else {
        for (let k = i; k < j; k++) {
          result.push(children[k]);
        }
      }

      i = j;
    }

    return result;
  }

  // Process top-level nodes as a group too
  const processed = processChildren(nodes);
  return processed;
}

/**
 * 3. Collapse navigation subtrees to single summary lines.
 */
function collapseNavigationNodes(nodes: SnapshotNode[]): SnapshotNode[] {
  function process(node: SnapshotNode): SnapshotNode {
    if (NAVIGATION_ROLES.has(node.role) && node.children.length > 0) {
      const childCount = countNodes([node]) - 1;
      const linkCount = countByRole(node.children, "link");
      const summary = node.name
        ? `${node.name} (${childCount} items, ${linkCount} links)`
        : `${childCount} items, ${linkCount} links`;

      // Replace children with a single summary child
      const summaryNode: SnapshotNode = {
        uid: "",
        role: "collapsed",
        name: `[${node.role}: ${summary}]`,
        attributes: "",
        depth: node.depth + 1,
        children: [],
        rawLine: `[${node.role}: ${summary}]`,
      };

      return {
        ...node,
        children: [summaryNode],
      };
    }

    // Recurse into non-navigation children
    return {
      ...node,
      children: node.children.map(process),
    };
  }

  return nodes.map(process);
}

function countByRole(nodes: SnapshotNode[], role: string): number {
  let count = 0;
  function walk(node: SnapshotNode): void {
    if (node.role === role) count++;
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
 * 4. Focus main content: when role=main exists, show only the path from root to main,
 *    the main subtree in full, and brief summaries of sibling subtrees.
 */
function focusMainContent(nodes: SnapshotNode[]): SnapshotNode[] {
  // Find the main landmark
  const mainPath = findNodePath(nodes, (n) => n.role === "main");
  if (!mainPath) return nodes; // No main landmark found
  const path = mainPath; // local binding for closure narrowing

  function processLevel(
    levelNodes: SnapshotNode[],
    pathIndex: number
  ): SnapshotNode[] {
    if (pathIndex >= path.length) return levelNodes;

    const targetUid = path[pathIndex].uid;

    return levelNodes.map((node) => {
      if (node.uid === targetUid || (!node.uid && node === path[pathIndex])) {
        if (pathIndex === path.length - 1) {
          // This is the main node - keep it fully
          return node;
        }
        // On the path to main - recurse into children
        return {
          ...node,
          children: processLevel(node.children, pathIndex + 1),
        };
      }

      // Sibling of the path - summarize
      const childCount = countNodes([node]);
      const summary: SnapshotNode = {
        uid: node.uid,
        role: node.role,
        name: node.name
          ? `${node.name} [${childCount} nodes collapsed]`
          : `[${childCount} nodes collapsed]`,
        attributes: node.attributes,
        depth: node.depth,
        children: [],
        rawLine: `${node.uid ? "uid=" + node.uid + " " : ""}${node.role} "${
          node.name || ""
        } [${childCount} nodes collapsed]"`,
      };
      return summary;
    });
  }

  return processLevel(nodes, 0);
}

/**
 * Find a path from root to a node matching the predicate.
 */
function findNodePath(
  nodes: SnapshotNode[],
  predicate: (node: SnapshotNode) => boolean
): SnapshotNode[] | null {
  for (const node of nodes) {
    if (predicate(node)) return [node];
    const childPath = findNodePath(node.children, predicate);
    if (childPath) return [node, ...childPath];
  }
  return null;
}

/**
 * 5a. Prune nodes beyond maxDepth.
 */
function pruneByDepth(
  nodes: SnapshotNode[],
  maxDepth: number,
  currentDepth = 0
): SnapshotNode[] {
  if (currentDepth >= maxDepth) {
    // At max depth, summarize any nodes that have children
    return nodes.map((node) => {
      if (node.children.length === 0) return node;
      const childCount = countNodes(node.children);
      const truncated: SnapshotNode = {
        ...node,
        children: [
          {
            uid: "",
            role: "collapsed",
            name: `[${childCount} descendant nodes truncated at depth ${maxDepth}]`,
            attributes: "",
            depth: node.depth + 1,
            children: [],
            rawLine: `[${childCount} descendant nodes truncated at depth ${maxDepth}]`,
          },
        ],
      };
      return truncated;
    });
  }

  return nodes.map((node) => ({
    ...node,
    children: pruneByDepth(node.children, maxDepth, currentDepth + 1),
  }));
}

/**
 * 5b. Cap total node count via breadth-first pruning.
 */
function capNodeCount(
  nodes: SnapshotNode[],
  maxNodes: number
): SnapshotNode[] {
  let remaining = maxNodes;

  function prune(levelNodes: SnapshotNode[]): SnapshotNode[] {
    const result: SnapshotNode[] = [];

    for (const node of levelNodes) {
      if (remaining <= 1) {
        // Reserve space for truncation notice
        result.push({
          uid: "",
          role: "collapsed",
          name: `[... remaining nodes truncated, limit=${maxNodes}]`,
          attributes: "",
          depth: node.depth,
          children: [],
          rawLine: `[... remaining nodes truncated, limit=${maxNodes}]`,
        });
        remaining = 0;
        break;
      }

      remaining--;
      result.push({
        ...node,
        children: prune(node.children),
      });
    }

    return result;
  }

  return prune(nodes);
}
