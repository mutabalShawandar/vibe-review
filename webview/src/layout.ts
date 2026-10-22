import { MarkerType, type Edge, type Node } from '@xyflow/react';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { GraphModel, GraphNode } from '../../src/core/types';
import { buildCard, CARD_WIDTH, cardHeight, visiblePort, type Card } from './card';

/** What a file card needs to draw itself. */
export interface CardData extends Record<string, unknown> {
  node: GraphNode;
  card: Card;
  expanded: boolean;
  /** While hovering: how each row (by key) relates to the hovered symbol. Absent when nothing is hovered. */
  marks?: Record<string, RowMark>;
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
  const nodes: FileCardNode[] = graph.nodes.map((node) => {
    const card = buildCard(node, expanded.has(node.id));
    cards.set(node.id, card);
    return {
      id: node.id,
      type: 'fileCard',
      position: { x: 0, y: 0 },
      data: { node, card, expanded: expanded.has(node.id) },
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
      // Several links can collapse onto the same two connection points; draw that arrow once.
      const id = `${edge.from}|${sourceHandle}->${edge.to}|${targetHandle}`;
      // The lines (in the importing file) that mention the imported name; merged when links collapse.
      const lines = [...new Set([...((edges.get(id)?.data?.lines as number[] | undefined) ?? []), ...(use.lines ?? [])])].sort((a, b) => a - b);
      edges.set(id, {
        id,
        source: edge.from, // the file that imports...
        target: edge.to, // ...this one
        sourceHandle,
        targetHandle,
        type: 'smoothstep',
        data: { lines },
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
};

/**
 * Position every card automatically. Files that are imported go on the left and the files that
 * import them on the right, so reading left to right follows the code from foundations to users.
 */
export async function layoutGraph(
  graph: GraphModel,
  expanded: ReadonlySet<string> = new Set(),
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

  const root: ElkNode = {
    id: 'root',
    layoutOptions: LAYOUT_OPTIONS,
    children: nodes.map((node) => ({ id: node.id, width: CARD_WIDTH, height: node.height })),
    // The layout sees every arrow reversed (imported file -> importing file), so that imported
    // files are placed first, on the left. The arrows we DRAW still point from importer to imported.
    edges: [...cardLinks.values()].map(({ from, to }, index) => ({ id: `e${index}`, sources: [to], targets: [from] })),
  };

  const laidOut = await elk.layout(root);
  const positions = new Map((laidOut.children ?? []).map((child) => [child.id, child]));

  return {
    nodes: nodes.map((node) => ({
      ...node,
      position: { x: positions.get(node.id)?.x ?? 0, y: positions.get(node.id)?.y ?? 0 },
    })),
    edges,
  };
}
