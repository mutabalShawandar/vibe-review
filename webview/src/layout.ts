import { MarkerType, Position, type Edge, type Node } from '@xyflow/react';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { GraphModel } from '../../src/core/types';

// Size of one box. Step 7c replaces the fixed height with one based on how many symbols a file has.
export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 44;

/**
 * Turn the extension's GraphModel into what React Flow draws, without positions yet.
 * Every position starts at 0,0; `layoutGraph` fills them in.
 */
export function toFlowElements(graph: GraphModel): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.nodes.map((node) => ({
    id: node.id,
    position: { x: 0, y: 0 },
    data: { label: node.id },
    // The status becomes a CSS class, so styles.css can color nodes by it.
    className: `status-${node.status}`,
    // Arrows leave a file on its left (towards what it imports) and arrive on its right
    // (from the files that import it), matching the left-to-right layout below.
    sourcePosition: Position.Left,
    targetPosition: Position.Right,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: `${edge.from}->${edge.to}`,
    source: edge.from, // the file that imports...
    target: edge.to, // ...this one
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
  }));

  return { nodes, edges };
}

// ELK computes positions from the size of each box and the arrows between them.
const elk = new ELK();

const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered', // arranges nodes in columns, minimizing crossing arrows
  'elk.direction': 'RIGHT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '90',
  'elk.spacing.nodeNode': '24',
  // Unconnected files form their own groups; keep the overall shape roughly screen-like.
  'elk.aspectRatio': '1.6',
};

/**
 * Position every box automatically. Files that are imported go on the left and the files that
 * import them on the right, so reading left to right follows the code from foundations to users.
 */
export async function layoutGraph(graph: GraphModel): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const { nodes, edges } = toFlowElements(graph);
  if (nodes.length === 0) {
    return { nodes, edges };
  }

  const root: ElkNode = {
    id: 'root',
    layoutOptions: LAYOUT_OPTIONS,
    children: nodes.map((node) => ({ id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    // The layout sees every arrow reversed (imported file -> importing file), so that imported
    // files are placed first, on the left. The arrows we DRAW still point from importer to imported.
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.target], targets: [edge.source] })),
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
