import { MarkerType, type Edge, type Node } from '@xyflow/react';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { GraphModel, GraphNode } from '../../src/core/types';
import { buildCard, CARD_WIDTH, cardHeight, FILE_PORT, portKey, visiblePort, type Card } from './card';
import { computeFeatures } from './review';
import type { UsageSite } from './route';
import { roleRank, ZONE_ORDER, zoneOf } from './zones';

/** What a file card needs to draw itself. */
export interface CardData extends Record<string, unknown> {
  node: GraphNode;
  card: Card;
  expanded: boolean;
  /** While hovering: how each row (by key) relates to the hovered symbol. Absent when nothing is hovered. */
  marks?: Record<string, RowMark>;
  /** While hovering: row keys that are on the route and must be listed even if the card hides them. */
  reveal?: ReadonlySet<string>;
  /** Set on changed files: the place in the feature's reading order (1 = start here) and the feature's color. */
  review?: { order: number; color: string };
  /** Set on cards of files edited a moment ago: the rows (keys) that are new or different. */
  fresh?: { rows: ReadonlySet<string> };
  /** True while the file is being written (a write happened a moment ago). */
  editing?: boolean;
}

/** `self` is the hovered symbol, `uses` is something it relies on (directly or not), `usedBy` something that relies on it. */
export type RowMark = 'self' | 'uses' | 'usedBy';
export type FileCardNode = Node<CardData, 'fileCard'>;

// Kept for tests and callers that need the size of a collapsed card of a given file.
export { CARD_WIDTH };

/** A stable color per file: the same path always gets the same hue, readable on light and dark themes. */
export function edgeColor(fileId: string): string {
  let hash = 0;
  for (const char of fileId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `hsl(${(hash * 137) % 360} 65% 55%)`;
}

/**
 * Turn the extension's GraphModel into what React Flow draws, without positions yet.
 *   - one card per file (taller when it lists more symbols)
 *   - one arrow per symbol-level link, from the connection point of the symbol that uses
 *     something to the connection point of the symbol it uses
 * `expanded` holds the ids of cards the user opened to show every symbol.
 */
export function toFlowElements(
  graph: GraphModel,
  expanded: ReadonlySet<string> = new Set(),
): { nodes: FileCardNode[]; edges: Edge[] } {
  const cards = new Map<string, Card>();
  // Every feature has its own reading order and its own color, shared by the badges of its files.
  const review = new Map<string, { order: number; color: string }>();
  for (const feature of computeFeatures(graph)) {
    for (const item of feature.items) {
      review.set(item.id, { order: item.order, color: edgeColor(feature.id) });
    }
  }
  const nodes: FileCardNode[] = graph.nodes.map((node) => {
    const card = buildCard(node, expanded.has(node.id));
    cards.set(node.id, card);
    return {
      id: node.id,
      type: 'fileCard',
      position: { x: 0, y: 0 },
      data: { node, card, expanded: expanded.has(node.id), review: review.get(node.id) },
      className: `status-${node.status}`,
      width: CARD_WIDTH,
      height: cardHeight(card),
    };
  });

  const edges = new Map<string, Edge>();
  for (const edge of graph.edges) {
    const fromCard = cards.get(edge.from);
    const toCard = cards.get(edge.to);
    if (!fromCard || !toCard) {
      continue;
    }
    for (const use of edge.uses) {
      // `s:` handles are where an arrow leaves a card, `t:` handles where it arrives.
      const sourceHandle = `s:${visiblePort(fromCard, use.from)}`;
      const targetHandle = `t:${visiblePort(toCard, use.to)}`;
      // The symbols the arrow is really between. A card that hides a row draws the arrow at the
      // row's class or the header, but hovering reveals the row and the arrow moves to it.
      const fromKey = use.from ? portKey(use.from.symbol, use.from.member) : FILE_PORT;
      const toKey = use.to ? portKey(use.to.symbol, use.to.member) : FILE_PORT;
      const id = `${edge.from}|${fromKey}->${edge.to}|${toKey}`;
      // Where the importing file writes the imported name (line and word); merged when links collapse.
      const sites = [...((edges.get(id)?.data?.sites as UsageSite[] | undefined) ?? [])];
      for (const line of use.lines ?? []) {
        if (!sites.some((site) => site.line === line && site.name === (use.name ?? ''))) {
          sites.push({ line, name: use.name ?? '' });
        }
      }
      sites.sort((a, b) => a.line - b.line);
      edges.set(id, {
        id,
        source: edge.from, // the file that imports...
        target: edge.to, // ...this one
        sourceHandle,
        targetHandle,
        type: 'smoothstep',
        data: { sites, fromKey, toKey },
        // All arrows leaving one file share a color, so a file's dependencies read as one group.
        style: { stroke: edgeColor(edge.from) },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(edge.from) },
      });
    }
  }

  return { nodes, edges: [...edges.values()] };
}

// ELK computes positions from the size of each box and the arrows between them.
const elk = new ELK();

const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered', // arranges nodes in columns, minimizing crossing arrows
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '110',
  'elk.spacing.nodeNode': '30',
  // Unconnected files form their own groups; keep the overall shape roughly screen-like.
  'elk.aspectRatio': '1.6',
  // Where the arrows allow either order, keep the order the cards were given in, so cards of one role stay together.
  'elk.layered.considerModelOrder.strategy': 'PREFER_NODES',
};

/** Empty space between two zones (frontend, backend...), in pixels: what tells them apart, since there are no borders. */
export const ZONE_GAP = 160;

export interface LayoutOptions {
  /** Stack the cards in bands by role (frontend on top, backend below) instead of one mixed diagram. Default true. */
  groupByRole?: boolean;
}

/**
 * Position every card automatically. Files that are imported go on the left and the files that
 * import them on the right, so reading left to right follows the code from foundations to users.
 */
export async function layoutGraph(
  graph: GraphModel,
  expanded: ReadonlySet<string> = new Set(),
  { groupByRole = true }: LayoutOptions = {},
): Promise<{ nodes: FileCardNode[]; edges: Edge[] }> {
  const { nodes, edges } = toFlowElements(graph, expanded);
  if (nodes.length === 0) {
    return { nodes, edges };
  }

  // The layout works on whole cards, so several symbol links between two cards count as one arrow.
  const cardLinks = new Map<string, { from: string; to: string }>();
  for (const edge of graph.edges) {
    cardLinks.set(`${edge.from}\0${edge.to}`, { from: edge.from, to: edge.to });
  }

  // One band per zone, each laid out on its own (only the arrows inside it count), then stacked
  // top to bottom. Arrows between bands are still drawn, they just do not shape the layout.
  const bands = groupByRole
    ? ZONE_ORDER.map((zone) => nodes.filter((node) => zoneOf(node.data.node.role) === zone)).filter((band) => band.length > 0)
    : [nodes];

  const positions = new Map<string, { x: number; y: number }>();
  let top = 0;
  for (const band of bands) {
    // Cards of one role sit together: the layout keeps this order wherever the arrows allow either.
    const ordered = [...band].sort(
      (a, b) => roleRank(a.data.node.role) - roleRank(b.data.node.role) || a.id.localeCompare(b.id),
    );
    const inBand = new Set(ordered.map((node) => node.id));
    const root: ElkNode = {
      id: 'root',
      layoutOptions: LAYOUT_OPTIONS,
      children: ordered.map((node) => ({ id: node.id, width: CARD_WIDTH, height: node.height })),
      // The layout sees every arrow reversed (imported file -> importing file), so that imported
      // files are placed first, on the left. The arrows we DRAW still point from importer to imported.
      edges: [...cardLinks.values()]
        .filter(({ from, to }) => inBand.has(from) && inBand.has(to))
        .map(({ from, to }, index) => ({ id: `e${index}`, sources: [to], targets: [from] })),
    };

    const laidOut = await elk.layout(root);
    let bottom = 0;
    for (const child of laidOut.children ?? []) {
      positions.set(child.id, { x: child.x ?? 0, y: top + (child.y ?? 0) });
      bottom = Math.max(bottom, (child.y ?? 0) + (child.height ?? 0));
    }
    top += bottom + ZONE_GAP;
  }

  return {
    nodes: nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? { x: 0, y: 0 } })),
    edges,
  };
}
