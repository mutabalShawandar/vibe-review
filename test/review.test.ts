import { describe, expect, it } from 'vitest';
import type { GraphModel, GraphNode } from '../src/core/types';
import { computeFeatures } from '../webview/src/review';

const node = (id: string, status: GraphNode['status'] = 'changed', changedSymbols = 1): GraphNode => ({
  id,
  language: 'typescript',
  status,
  symbols: [{ name: 'x', kind: 'function', startLine: 1, endLine: 2, changed: changedSymbols > 0, relevant: true }],
});

// Two unrelated features: auth/session.ts <- auth/login.ts, and billing/invoice.ts alone.
// ui/Menu.tsx is unchanged and only uses login.ts.
const graph: GraphModel = {
  scope: 'changes',
  nodes: [node('auth/session.ts'), node('auth/login.ts'), node('billing/invoice.ts'), node('ui/Menu.tsx', 'dependent', 0)],
  edges: [
    { from: 'auth/login.ts', to: 'auth/session.ts', uses: [{}] },
    { from: 'ui/Menu.tsx', to: 'auth/login.ts', uses: [{}] },
  ],
  reviewOrder: ['auth/session.ts', 'auth/login.ts', 'billing/invoice.ts'],
};

describe('computeFeatures', () => {
  const features = computeFeatures(graph);

  it('splits unrelated changes into separate features, each with its own start', () => {
    expect(features.map((f) => [f.title, f.items.map((i) => [i.id, i.order])])).toEqual([
      ['auth', [['auth/session.ts', 1], ['auth/login.ts', 2]]],
      ['invoice.ts', [['billing/invoice.ts', 1]]],
    ]);
  });

  it('says why each file is where it is', () => {
    const [session, login] = features[0].items;
    expect(session.reason).toBe('1 changed symbol · used by 1 file · read it first, the rest builds on it');
    expect(login.reason).toBe('1 changed symbol · used by 1 file · builds on 1 changed file');
    expect(features[1].items[0].reason).toBe('1 changed symbol · nothing uses it');
  });

  it('is empty when nothing changed', () => {
    expect(computeFeatures({ ...graph, nodes: [], edges: [], reviewOrder: [] })).toEqual([]);
  });
});
