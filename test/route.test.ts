import { describe, expect, it } from 'vitest';
import type { GraphModel, GraphSymbol } from '../src/core/types';
import { toFlowElements } from '../webview/src/layout';
import { editorMarks } from '../webview/src/route';

const symbol = (name: string, startLine: number, endLine: number, changed = false): GraphSymbol => ({
  name,
  kind: 'function',
  startLine,
  endLine,
  changed,
  relevant: true,
});

// users.ts defines getUsers (changed); page.tsx imports it and calls it on lines 5 and 7 of UsersPage.
const graph: GraphModel = {
  scope: 'changes',
  nodes: [
    { id: 'users.ts', language: 'typescript', status: 'changed', symbols: [symbol('getUsers', 1, 5, true)] },
    { id: 'page.tsx', language: 'typescript', status: 'dependent', symbols: [symbol('UsersPage', 3, 10)] },
  ],
  edges: [
    {
      from: 'page.tsx',
      to: 'users.ts',
      uses: [{ from: { symbol: 'UsersPage' }, to: { symbol: 'getUsers' }, lines: [5, 7] }],
    },
  ],
  reviewOrder: ['users.ts'],
};

describe('editorMarks', () => {
  const { edges } = toFlowElements(graph);

  it('marks the symbols that use the clicked one, and the lines where they use it', () => {
    const marks = editorMarks(graph.nodes, edges, { id: 'users.ts', key: 'getUsers' });
    expect(marks.highlights).toEqual([{ file: 'page.tsx', startLine: 3, endLine: 10, role: 'usedBy', direct: true }]);
    expect(marks.sites).toEqual([
      { file: 'page.tsx', line: 5, role: 'usedBy' },
      { file: 'page.tsx', line: 7, role: 'usedBy' },
    ]);
  });

  it('marks what the clicked symbol uses, and the lines in the clicked symbol that use it', () => {
    const marks = editorMarks(graph.nodes, edges, { id: 'page.tsx', key: 'UsersPage' });
    expect(marks.highlights).toEqual([{ file: 'users.ts', startLine: 1, endLine: 5, role: 'uses', direct: true }]);
    expect(marks.sites).toEqual([
      { file: 'page.tsx', line: 5, role: 'uses' },
      { file: 'page.tsx', line: 7, role: 'uses' },
    ]);
  });

  it('marks the routes of every symbol when a whole file is clicked', () => {
    const marks = editorMarks(graph.nodes, edges, { id: 'users.ts' });
    expect(marks.highlights.map((h) => h.file)).toEqual(['page.tsx']);
  });
});
