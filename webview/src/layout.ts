import { MarkerType, type Edge, type Node } from '@xyflow/react';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { GraphModel, GraphNode } from '../../src/core/types';
import { buildCard, CARD_WIDTH, cardHeight, FILE_PORT, portKey, visiblePort, type Card } from './card';
import type { Group } from './groups';
import { computeFeatures } from './review';
import type { UsageSite } from './route';

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

/** What a folder box needs to draw itself, collapsed (`groupCard`, one small card) or open (`groupBox`, a frame around its files). */
export interface GroupData extends Record<string, unknown> {
  group: Group;
  open: boolean;
  /** How many of the folder's files are changed in git. */
  changedCount: number;
}
export type GroupFlowNode = Node<GroupData, 'groupCard' | 'groupBox'>;

/** What a route card needs: one URL segment of a file-routed framework and the files that make it up. */
export interface RouteData extends Record<string, unknown> {
  /** The card's title: "[id]", "users/[id]", or "Not in a route". */
  title: string;
  /** The full URL path, for the tooltip. Absent for the card of files outside every route. */
  path?: string;
  /** The project folder, shown when the workspace has more than one project. */
  project?: string;
  /** The files listed as rows, in the order a request meets them. */
  files: GraphNode[];
  /** Files that are not listed (the card of files outside every route lists only what matters to a review). */
  hiddenFiles: number;
  /** Routes below this one, and whether they are folded away. Absent when there is nothing to fold. */
  fold?: { children: number; collapsed: boolean };
  changedCount: number;
}
export type RouteFlowNode = Node<RouteData, 'routeCard'>;

/** Anything React Flow draws for a graph. */
export type FlowNode = FileCardNode | GroupFlowNode | RouteFlowNode;

/** Which files are drawn inside folder boxes, and which boxes are open. Without it every file is its own card. */
export interface Grouping {
  groups: readonly Group[];
  /** Keys of the open groups; the others are collapsed into one card. */
  open: ReadonlySet<string>;
}

/** Size of a collapsed folder card, and the frame of an open one (title on top, room around the files). */
export const GROUP_CARD_HEIGHT = 84;
export const GROUP_HEADER = 48;
export const GROUP_PADDING = 16;
export const groupNodeId = (key: string) => `group:${key}`;

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

/** Where a node is on the canvas. Files inside a folder frame store their position relative to it. */
export function absolutePosition(node: FlowNode, nodes: readonly FlowNode[]): { x: number; y: number } {
  let { x, y } = node.position;
  let parent = node.parentId;
  while (parent) {
    const frame = nodes.find((candidate) => candidate.id === parent);
    if (!frame) {
      break;
    }
    x += frame.position.x;
    y += frame.position.y;
    parent = frame.parentId;
  }
  return { x, y };
}

/**
 * Turn the extension's GraphModel into what React Flow draws, without positions yet.
 *   - one card per file (taller when it lists more symbols)
 *   - one arrow per symbol-level link, from the connection point of the symbol that uses
 *     something to the connection point of the symbol it uses
 * `expanded` holds the ids of cards the user opened to show every symbol.
 *
 * With `grouping`, files sit in folder boxes. A collapsed box is a single small card, and every
 * arrow that reaches one of its files ends at that card; arrows between the same two ends are merged.
 */
export function toFlowElements(
  graph: GraphModel,
  expanded: ReadonlySet<string> = new Set(),
  grouping?: Grouping,
): { nodes: FlowNode[]; edges: Edge[] } {
  const cards = new Map<string, Card>();
  // Every feature has its own reading order and its own color, shared by the badges of its files.
  const review = new Map<string, { order: number; color: string }>();
  for (const feature of computeFeatures(graph)) {
    for (const item of feature.items) {
      review.set(item.id, { order: item.order, color: edgeColor(feature.id) });
    }
  }

  // Which box each file is in, and whether that box is closed.
  const groupOf = new Map<string, Group>();
  for (const group of grouping?.groups ?? []) {
    group.ids.forEach((id) => groupOf.set(id, group));
  }
  const isHidden = (id: string) => {
    const group = groupOf.get(id);
    return group !== undefined && !grouping!.open.has(group.key);
  };
  /** Where an arrow to this file ends: the file's card, or its folder's card when the folder is collapsed. */
  const endOf = (id: string) => (isHidden(id) ? groupNodeId(groupOf.get(id)!.key) : id);

  const fileNode = (node: GraphNode): FileCardNode => {
    const card = buildCard(node, expanded.has(node.id));
    cards.set(node.id, card);
    const group = groupOf.get(node.id);
    return {
      id: node.id,
      type: 'fileCard',
      position: { x: 0, y: 0 },
      data: { node, card, expanded: expanded.has(node.id), review: review.get(node.id) },
      className: `status-${node.status}`,
      width: CARD_WIDTH,
      height: cardHeight(card),
      ...(group ? { parentId: groupNodeId(group.key) } : {}),
    };
  };

  const nodes: FlowNode[] = [];
  if (grouping) {
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const group of grouping.groups) {
      const open = grouping.open.has(group.key);
      const files = group.ids.flatMap((id) => byId.get(id) ?? []);
      nodes.push({
        id: groupNodeId(group.key),
        type: open ? 'groupBox' : 'groupCard',
        position: { x: 0, y: 0 },
        data: { group, open, changedCount: files.filter((node) => node.status === 'changed').length },
        width: CARD_WIDTH,
        height: open ? GROUP_HEADER : GROUP_CARD_HEIGHT,
        // A frame sits behind its files and does not take the pointer away from them.
        ...(open ? { zIndex: -1 } : {}),
      });
      if (open) {
        nodes.push(...files.map(fileNode)); // a frame must come before the files inside it
      }
    }
  } else {
    nodes.push(...graph.nodes.map(fileNode));
  }

  const edges = new Map<string, Edge>();
  for (const edge of graph.edges) {
    const source = endOf(edge.from);
    const target = endOf(edge.to);
    if (source === target && source !== edge.from) {
      continue; // between two files of one collapsed folder: nothing to draw
    }

    // One of the ends is a collapsed folder: a single merged arrow between the two cards.
    if (source !== edge.from || target !== edge.to) {
      const id = `${source}->${target}`;
      const count = ((edges.get(id)?.data?.count as number | undefined) ?? 0) + edge.uses.length;
      edges.set(id, {
        id,
        source,
        target,
        sourceHandle: `s:${FILE_PORT}`,
        targetHandle: `t:${FILE_PORT}`,
        type: 'smoothstep',
        data: { sites: [], fromKey: FILE_PORT, toKey: FILE_PORT, count },
        style: { stroke: edgeColor(source) },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(source) },
      });
      continue;
    }

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
  // Network simplex keeps arrows short and columns balanced: on a 74-file graph it cut the height by 30%.
  'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.spacing.nodeNodeBetweenLayers': '110',
  'elk.spacing.nodeNode': '30',
  // Unconnected files form their own groups; keep the overall shape roughly screen-like.
  'elk.aspectRatio': '1.6',
};

// An open folder is laid out like the whole diagram, inside its frame.
const FRAME_OPTIONS = {
  ...LAYOUT_OPTIONS,
  'elk.padding': `[top=${GROUP_HEADER},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`,
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
};

/**
 * Position every card automatically. Files that are imported go on the left and the files that
 * import them on the right, so reading left to right follows the code from foundations to users.
 * With `grouping`, each folder box is placed as one unit and its files are laid out inside it.
 */
export async function layoutGraph(
  graph: GraphModel,
  expanded: ReadonlySet<string> = new Set(),
  grouping?: Grouping,
): Promise<{ nodes: FlowNode[]; edges: Edge[] }> {
  const { nodes, edges } = toFlowElements(graph, expanded, grouping);
  if (nodes.length === 0) {
    return { nodes, edges };
  }

  // The layout works on whole cards, so several symbol links between two cards count as one arrow.
  const cardLinks = new Map<string, { from: string; to: string }>();
  for (const edge of edges) {
    cardLinks.set(`${edge.source}\0${edge.target}`, { from: edge.source, to: edge.target });
  }

  const elkNode = (node: FlowNode): ElkNode => ({ id: node.id, width: CARD_WIDTH, height: node.height });
  const root: ElkNode = {
    id: 'root',
    layoutOptions: grouping ? { ...LAYOUT_OPTIONS, 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' } : LAYOUT_OPTIONS,
    children: grouping
      ? nodes
          .filter((node) => node.type === 'groupCard' || node.type === 'groupBox')
          .map((frame) => ({
            ...elkNode(frame),
            ...(frame.type === 'groupBox'
              ? {
                  layoutOptions: FRAME_OPTIONS,
                  children: nodes.filter((node) => node.parentId === frame.id).map(elkNode),
                }
              : {}),
          }))
      : nodes.map(elkNode),
    // The layout sees every arrow reversed (imported file -> importing file), so that imported
    // files are placed first, on the left. The arrows we DRAW still point from importer to imported.
    edges: [...cardLinks.values()].map(({ from, to }, index) => ({ id: `e${index}`, sources: [to], targets: [from] })),
  };

  const laidOut = await elk.layout(root);
  // Files inside a frame are positioned relative to it, which is also how React Flow places child nodes.
  const placed = new Map<string, ElkNode>();
  const collect = (parent: ElkNode) =>
    (parent.children ?? []).forEach((child) => {
      placed.set(child.id, child);
      collect(child);
    });
  collect(laidOut);

  return {
    nodes: nodes.map((node) => {
      const at = placed.get(node.id);
      const frame = node.type === 'groupBox' ? { width: at?.width ?? CARD_WIDTH, height: at?.height ?? GROUP_HEADER } : {};
      return { ...node, ...frame, position: { x: at?.x ?? 0, y: at?.y ?? 0 } } as FlowNode;
    }),
    edges,
  };
}
