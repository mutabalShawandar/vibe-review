import { describe, expect, it } from 'vitest';
import type { GraphModel } from '../src/core/types';
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH, toFlowElements } from '../webview/src/layout';

const graph: GraphModel = {
  scope: 'changes',
  nodes: [
    { id: 'a.ts', language: 'typescript', status: 'changed', symbols: [] },
    { id: 'b.ts', language: 'typescript', status: 'dependent', symbols: [] },
    { id: 'c.ts', language: 'typescript', status: 'dependency', symbols: [] },
  ],
  edges: [
    { from: 'b.ts', to: 'a.ts', uses: [{}] },
    { from: 'a.ts', to: 'c.ts', uses: [{}] },
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

describe('layoutGraph', () => {
  const positionsOf = async (g: GraphModel) =>
    Object.fromEntries((await layoutGraph(g)).nodes.map((n) => [n.id, n.position]));

  it('puts imported files to the left of the files that import them', async () => {
    // b imports a, a imports c  =>  reading order left to right is c, a, b
    const at = await positionsOf(graph);
    expect(at['c.ts'].x).toBeLessThan(at['a.ts'].x);
    expect(at['a.ts'].x).toBeLessThan(at['b.ts'].x);
  });

  it('never lets two boxes overlap', async () => {
    const wide: GraphModel = {
      scope: 'full',
      nodes: Array.from({ length: 30 }, (_, i) => ({
        id: `f${i}.ts`,
        language: 'typescript',
        status: 'unchanged' as const,
        symbols: [],
      })),
      // a hub imported by everything, plus a chain, plus unconnected files
      edges: [
        ...Array.from({ length: 15 }, (_, i) => ({ from: `f${i + 1}.ts`, to: 'f0.ts', uses: [{}] })),
        { from: 'f16.ts', to: 'f17.ts', uses: [{}] },
        { from: 'f17.ts', to: 'f18.ts', uses: [{}] },
      ],
      reviewOrder: [],
    };
    const { nodes } = await layoutGraph(wide);
    for (const a of nodes) {
      for (const b of nodes) {
        if (a.id < b.id) {
          const apartX = Math.abs(a.position.x - b.position.x) >= NODE_WIDTH;
          const apartY = Math.abs(a.position.y - b.position.y) >= NODE_HEIGHT;
          expect(apartX || apartY, `${a.id} overlaps ${b.id}`).toBe(true);
        }
      }
    }
  });

  it('copes with circular imports', async () => {
    const circle: GraphModel = {
      scope: 'full',
      nodes: ['a', 'b'].map((id) => ({ id, language: 'typescript', status: 'unchanged' as const, symbols: [] })),
      edges: [
        { from: 'a', to: 'b', uses: [{}] },
        { from: 'b', to: 'a', uses: [{}] },
      ],
      reviewOrder: [],
    };
    expect((await layoutGraph(circle)).nodes).toHaveLength(2);
  });

  it('returns nothing for an empty graph', async () => {
    expect(await layoutGraph({ scope: 'full', nodes: [], edges: [], reviewOrder: [] })).toEqual({ nodes: [], edges: [] });
  });
});
