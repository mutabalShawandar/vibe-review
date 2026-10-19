import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { GraphModel } from '../../src/core/types';

// Temporary layout (step 7a): a simple grid. Step 7b replaces it with automatic layout (elkjs).
const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 90;

/** Turn the extension's GraphModel into what React Flow draws. */
export function toFlowElements(graph: GraphModel): { nodes: Node[]; edges: Edge[] } {
  const columns = Math.max(1, Math.ceil(Math.sqrt(graph.nodes.length)));

  const nodes: Node[] = graph.nodes.map((node, index) => ({
    id: node.id,
    position: { x: (index % columns) * COLUMN_WIDTH, y: Math.floor(index / columns) * ROW_HEIGHT },
    data: { label: node.id },
    // The status becomes a CSS class, so styles.css can color nodes by it.
    className: `status-${node.status}`,
    // Only moves nodes on screen; nothing in the project changes.
    draggable: true,
  }));

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
    markerEnd: { type: MarkerType.ArrowClosed },
  }));

  return { nodes, edges };
}
