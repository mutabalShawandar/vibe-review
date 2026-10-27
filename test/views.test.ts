import { describe, expect, it } from 'vitest';
import type { GraphModel, GraphNode } from '../src/core/types';
import { groupNodeId } from '../webview/src/layout';
import { filesView } from '../webview/src/views/filesView';
import { foldersView, groupingFor } from '../webview/src/views/foldersView';
import { rendererFor, viewKindFor } from '../webview/src/views';

const file = (id: string, status: GraphNode['status'] = 'unchanged'): GraphNode => ({ id, language: 'typescript', status, symbols: [] });
const graph = (scope: GraphModel['scope'], nodes: GraphNode[]): GraphModel => ({ scope, nodes, edges: [], reviewOrder: [] });

const full = graph('full', [file('web/page.tsx', 'changed'), file('web/card.tsx'), file('lib/db.ts'), file('lib/auth.ts')]);

describe('view registry', () => {
  it('shows Changes file by file and Full System in folders', () => {
    expect(viewKindFor(graph('changes', []))).toBe('files');
    expect(viewKindFor(graph('full', []))).toBe('folders');
  });

  it('finds a renderer by kind and rejects an unknown one', () => {
    expect(rendererFor('files')).toBe(filesView);
    expect(rendererFor('folders')).toBe(foldersView);
    expect(() => rendererFor('nope')).toThrow(/Unknown view "nope"/);
  });
});

describe('files view', () => {
  it('lays out one card per file and has nothing to toggle or reveal', async () => {
    const g = graph('changes', [file('a.ts'), file('b.ts')]);
    const { nodes } = await filesView.layout(g, new Set(), filesView.initialState);

    expect(nodes.map((n) => [n.id, n.type])).toEqual([
      ['a.ts', 'fileCard'],
      ['b.ts', 'fileCard'],
    ]);
    expect(filesView.toggleNode(g, undefined, 'a.ts')).toBeUndefined();
    expect(filesView.reveal(g, undefined, 'a.ts')).toBeUndefined();
  });
});

describe('folders view', () => {
  const initial = foldersView.initialState;

  it('opens the folders that hold a changed file and collapses the rest', () => {
    expect([...groupingFor(full, initial).open]).toEqual(['web']);
  });

  it('lays out an open folder as a frame with its files and a closed one as a card', async () => {
    const { nodes } = await foldersView.layout(full, new Set(), initial);
    expect(nodes.map((n) => [n.id, n.type])).toEqual([
      [groupNodeId('lib'), 'groupCard'],
      [groupNodeId('web'), 'groupBox'],
      ['web/page.tsx', 'fileCard'],
      ['web/card.tsx', 'fileCard'],
    ]);
  });

  it('toggles a folder against what it is now, including the default', () => {
    const closedWeb = foldersView.toggleNode(full, initial, groupNodeId('web'));
    expect([...groupingFor(full, closedWeb).open]).toEqual([]);

    const openedLib = foldersView.toggleNode(full, closedWeb, groupNodeId('lib'));
    expect([...groupingFor(full, openedLib).open]).toEqual(['lib']);

    const reopenedWeb = foldersView.toggleNode(full, openedLib, groupNodeId('web'));
    expect([...groupingFor(full, reopenedWeb).open].sort()).toEqual(['lib', 'web']);
  });

  it('keeps the reader\'s choice even when the file set changes', () => {
    const closedWeb = foldersView.toggleNode(full, initial, groupNodeId('web'));
    const later = graph('full', [...full.nodes, file('web/extra.tsx', 'changed')]);
    expect([...groupingFor(later, closedWeb).open]).toEqual([]);
  });

  it('ignores a click on a node that is not a folder', () => {
    expect(foldersView.toggleNode(full, initial, 'web/page.tsx')).toBe(initial);
  });

  it('reveals a file by opening its folder, and says nothing changed when it is visible already', () => {
    const revealed = foldersView.reveal(full, initial, 'lib/db.ts');
    expect(revealed).not.toBe(initial);
    expect([...groupingFor(full, revealed).open].sort()).toEqual(['lib', 'web']);

    expect(foldersView.reveal(full, initial, 'web/card.tsx')).toBe(initial); // web is open already
    expect(foldersView.reveal(full, initial, 'unknown.ts')).toBe(initial); // not in the graph at all
  });

  it('keeps every folder when several files are revealed one after another from the latest state', () => {
    const three = graph('full', [...full.nodes, file('src/core/x.ts'), file('src/ui/y.ts')]);
    const first = foldersView.reveal(three, initial, 'src/core/x.ts');
    const both = foldersView.reveal(three, first, 'src/ui/y.ts');

    expect([...groupingFor(three, both).open].sort()).toEqual(['src/core', 'src/ui', 'web']);
  });
});
