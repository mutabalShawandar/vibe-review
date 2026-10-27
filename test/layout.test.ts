import { describe, expect, it } from 'vitest';
import type { GraphModel } from '../src/core/types';
import { groupNodes } from '../webview/src/groups';
import { absolutePosition, CARD_WIDTH, groupNodeId, layoutGraph, toFlowElements, type FileCardNode } from '../webview/src/layout';

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
    expect((nodes[0] as FileCardNode).data.node.id).toBe('a.ts');
  });

  it('draws an arrow from the importing file to the imported file', () => {
    const { edges } = toFlowElements(graph);
    expect(edges.map((e) => [e.source, e.target])).toEqual([
      ['b.ts', 'a.ts'],
      ['a.ts', 'c.ts'],
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
          const apartX = Math.abs(a.position.x - b.position.x) >= CARD_WIDTH;
          const apartY = Math.abs(a.position.y - b.position.y) >= (a.position.y < b.position.y ? a.height! : b.height!);
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

describe('grouped layout', () => {
  const file = (id: string, status: 'changed' | 'unchanged' = 'unchanged') => ({ id, language: 'typescript', status, symbols: [] });
  const grouped: GraphModel = {
    scope: 'full',
    nodes: [file('web/page.tsx', 'changed'), file('web/card.tsx'), file('lib/db.ts'), file('lib/auth.ts'), file('lib/util.ts')],
    edges: [
      { from: 'web/page.tsx', to: 'web/card.tsx', uses: [{}] },
      { from: 'web/page.tsx', to: 'lib/db.ts', uses: [{}] },
      { from: 'web/card.tsx', to: 'lib/auth.ts', uses: [{}] },
      { from: 'lib/auth.ts', to: 'lib/db.ts', uses: [{}] },
    ],
    reviewOrder: ['web/page.tsx'],
  };
  const groups = groupNodes(grouped.nodes);
  const lib = groupNodeId('lib');
  const web = groupNodeId('web');

  it('draws a collapsed folder as one card and merges the arrows that reach it', () => {
    const { nodes, edges } = toFlowElements(grouped, new Set(), { groups, open: new Set(['web']) });

    expect(nodes.map((n) => [n.id, n.type])).toEqual([
      [lib, 'groupCard'],
      [web, 'groupBox'], // a frame comes before the files inside it
      ['web/page.tsx', 'fileCard'],
      ['web/card.tsx', 'fileCard'],
    ]);
    // page -> db and card -> auth both end at the collapsed lib card; the arrow inside web stays a file arrow
    expect(edges.map((e) => [e.source, e.target]).sort()).toEqual([
      ['web/card.tsx', lib],
      ['web/page.tsx', lib],
      ['web/page.tsx', 'web/card.tsx'],
    ]);
  });

  it('draws nothing for arrows between two files of one collapsed folder', () => {
    const { edges } = toFlowElements(grouped, new Set(), { groups, open: new Set() });
    expect(edges.map((e) => [e.source, e.target])).toEqual([[web, lib]]);
  });

  it('keeps every file inside its frame and every box apart', async () => {
    const { nodes } = await layoutGraph(grouped, new Set(), { groups, open: new Set(['web', 'lib']) });
    const frame = (id: string) => nodes.find((n) => n.id === id)!;

    for (const n of nodes.filter((candidate) => candidate.parentId)) {
      const parent = frame(n.parentId!);
      expect(n.position.x, n.id).toBeGreaterThanOrEqual(0);
      expect(n.position.y, n.id).toBeGreaterThanOrEqual(0);
      expect(n.position.x + n.width!, n.id).toBeLessThanOrEqual(parent.width!);
      expect(n.position.y + n.height!, n.id).toBeLessThanOrEqual(parent.height!);
    }
    const [a, b] = [frame(web), frame(lib)];
    const apartX = a.position.x + a.width! <= b.position.x || b.position.x + b.width! <= a.position.x;
    const apartY = a.position.y + a.height! <= b.position.y || b.position.y + b.height! <= a.position.y;
    expect(apartX || apartY).toBe(true);
  });

  it('puts the importing folder to the right of the folder it imports', async () => {
    const { nodes } = await layoutGraph(grouped, new Set(), { groups, open: new Set() });
    const x = (id: string) => nodes.find((n) => n.id === id)!.position.x;
    expect(x(lib)).toBeLessThan(x(web));
  });

  it('finds the position of a file on the canvas, not inside its frame', async () => {
    const { nodes } = await layoutGraph(grouped, new Set(), { groups, open: new Set(['web']) });
    const page = nodes.find((n) => n.id === 'web/page.tsx')!;
    const frame = nodes.find((n) => n.id === web)!;
    expect(absolutePosition(page, nodes)).toEqual({ x: frame.position.x + page.position.x, y: frame.position.y + page.position.y });
  });
});
