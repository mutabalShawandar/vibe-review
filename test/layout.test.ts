import { describe, expect, it } from 'vitest';
import type { GraphModel } from '../src/core/types';
import { toFlowElements } from '../webview/src/layout';

const graph: GraphModel = {
  scope: 'changes',
  nodes: [
    { id: 'a.ts', language: 'typescript', status: 'changed', symbols: [] },
    { id: 'b.ts', language: 'typescript', status: 'dependent', symbols: [] },
    { id: 'c.ts', language: 'typescript', status: 'dependency', symbols: [] },
  ],
  edges: [
    { from: 'b.ts', to: 'a.ts' },
    { from: 'a.ts', to: 'c.ts' },
  ],
  reviewOrder: ['a.ts'],
};

describe('toFlowElements', () => {
  it('creates one box per file, with its status as a CSS class', () => {
    const { nodes } = toFlowElements(graph);
    expect(nodes.map((n) => [n.id, n.className])).toEqual([
      ['a.ts', 'status-changed'],
      ['b.ts', 'status-dependent'],
      ['c.ts', 'status-dependency'],
    ]);
    expect(nodes[0].data.label).toBe('a.ts');
  });

  it('gives every box its own position', () => {
    const { nodes } = toFlowElements(graph);
    const positions = new Set(nodes.map((n) => `${n.position.x},${n.position.y}`));
    expect(positions.size).toBe(3);
  });

  it('draws an arrow from the importing file to the imported file', () => {
    const { edges } = toFlowElements(graph);
    expect(edges.map((e) => [e.id, e.source, e.target])).toEqual([
      ['b.ts->a.ts', 'b.ts', 'a.ts'],
      ['a.ts->c.ts', 'a.ts', 'c.ts'],
    ]);
  });

  it('handles an empty graph', () => {
    expect(toFlowElements({ scope: 'full', nodes: [], edges: [], reviewOrder: [] })).toEqual({ nodes: [], edges: [] });
  });
});
