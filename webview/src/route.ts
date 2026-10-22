import type { GraphNode, GraphSymbol } from '../../src/core/types';
import type { CodeHighlight, CodeSite } from '../../src/ui/messages';

// The "route" of a symbol: every symbol connected to it by arrows. An arrow runs from the symbol
// that uses something to the symbol it uses, so the route is everything reachable by following
// arrows forward (what it uses, and what that uses...) and backward (what uses it, and so on).
// Used for the hover highlight and for the editor highlights after a click.

/** The parts of a React Flow edge the route needs. */
export interface RouteEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface Route<E extends RouteEdge> {
  /** The hovered symbol, or for a whole card every symbol of it that has an arrow. Entries look like `file.ts|Class.method`. */
  start: Set<string>;
  /** Everything the start symbols use, directly or not (includes `start`). */
  downstream: Set<string>;
  /** Everything that uses the start symbols, directly or not (includes `start`). */
  upstream: Set<string>;
  /** Every arrow on the route. */
  edges: Set<E>;
  /** Symbols one arrow away: `uses` are used by the start, `usedBy` use the start. */
  direct: { uses: Set<string>; usedBy: Set<string> };
}

// A symbol is identified by its card and row key ("file" is the card header).
// Handle ids look like `s:UserService.find` (arrow leaves) or `t:UserService.find` (arrow arrives).
const from = (edge: RouteEdge) => `${edge.source}|${(edge.sourceHandle ?? '').slice(2)}`;
const to = (edge: RouteEdge) => `${edge.target}|${(edge.targetHandle ?? '').slice(2)}`;

export function computeRoute<E extends RouteEdge>(edges: readonly E[], target: { id: string; key?: string }): Route<E> {
  const start = new Set<string>();
  for (const edge of edges) {
    for (const end of [from(edge), to(edge)]) {
      if (target.key ? end === `${target.id}|${target.key}` : end.startsWith(`${target.id}|`)) {
        start.add(end);
      }
    }
  }

  const downstream = new Set(start);
  const upstream = new Set(start);
  const hot = new Set<E>();
  const direct = { uses: new Set<string>(), usedBy: new Set<string>() };

  for (const edge of edges) {
    if (start.has(from(edge))) {
      direct.uses.add(to(edge));
    }
    if (start.has(to(edge))) {
      direct.usedBy.add(from(edge));
    }
  }

  // Repeat until nothing new is reached; sets make circular imports harmless.
  for (let changed = true; changed; ) {
    changed = false;
    for (const edge of edges) {
      if (downstream.has(from(edge)) && !downstream.has(to(edge))) {
        downstream.add(to(edge));
        changed = true;
      }
      if (upstream.has(to(edge)) && !upstream.has(from(edge))) {
        upstream.add(from(edge));
        changed = true;
      }
      if (downstream.has(from(edge)) || upstream.has(to(edge))) {
        hot.add(edge);
      }
    }
  }

  return { start, downstream, upstream, edges: hot, direct };
}

/** Where a row (`key` as in a card row) is declared in its file, or undefined for the file as a whole. */
export function rangeOf(node: GraphNode, key: string): { startLine: number; endLine: number } | undefined {
  const find = (symbols: GraphSymbol[] | undefined, name: string) => symbols?.find((symbol) => symbol.name === name);
  const [symbolName, memberName] = key.split('.', 2);
  const symbol = find(node.symbols, symbolName);
  const found = memberName ? find(symbol?.members, memberName) : symbol;
  return found && { startLine: found.startLine, endLine: found.endLine };
}

/** What the editor should mark after a click, see the `open` message in ui/messages.ts. */
export interface EditorMarks {
  highlights: CodeHighlight[];
  sites: CodeSite[];
}

/**
 * The code to mark for a clicked symbol (or a whole file, without `key`):
 *   - highlights: the symbols on its route, whole, and whether they are one arrow away
 *   - sites: the exact lines where a name is imported-and-used along the route
 * `edges` are the React Flow edges; their `data.lines` come from the symbol links.
 */
export function editorMarks(
  nodes: readonly GraphNode[],
  edges: readonly (RouteEdge & { data?: { lines?: number[] } })[],
  target: { id: string; key?: string },
): EditorMarks {
  const route = computeRoute(edges, target);
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const highlights: CodeHighlight[] = [];
  const listed = new Set<string>();
  for (const [set, role, direct] of [
    [route.downstream, 'uses', route.direct.uses],
    [route.upstream, 'usedBy', route.direct.usedBy],
  ] as const) {
    for (const end of set) {
      const split = end.indexOf('|');
      const file = end.slice(0, split);
      const node = byId.get(file);
      const range = node && rangeOf(node, end.slice(split + 1));
      // Skip the clicked symbol itself and the file-level connection point (it has no range).
      if (!range || route.start.has(end) || listed.has(`${file}:${range.startLine}`)) {
        continue;
      }
      listed.add(`${file}:${range.startLine}`);
      highlights.push({ file, ...range, role, direct: direct.has(end) });
    }
  }

  // An arrow leaves the file that writes the name, so its lines belong to the arrow's source file.
  const sites: CodeSite[] = [];
  const seen = new Set<string>();
  for (const edge of route.edges) {
    const reachedForward = route.downstream.has(`${edge.source}|${(edge.sourceHandle ?? '').slice(2)}`);
    for (const line of edge.data?.lines ?? []) {
      const role = reachedForward ? 'uses' : 'usedBy';
      if (!seen.has(`${edge.source}:${line}:${role}`)) {
        seen.add(`${edge.source}:${line}:${role}`);
        sites.push({ file: edge.source, line, role });
      }
    }
  }
  return { highlights, sites };
}
