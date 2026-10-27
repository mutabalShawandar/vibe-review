import { describe, expect, it } from 'vitest';
import type { GraphModel, GraphNode } from '../src/core/types';
import { groupNodeId } from '../webview/src/layout';
import { filesView } from '../webview/src/views/filesView';
import { foldersView, groupingFor } from '../webview/src/views/foldersView';
import { rendererFor, viewKindFor, viewsFor } from '../webview/src/views';
import { mainRole, routesView } from '../webview/src/views/routesView';
import { OTHER_ID, routeNodeId } from '../webview/src/routes';

const file = (id: string, status: GraphNode['status'] = 'unchanged'): GraphNode => ({ id, language: 'typescript', status, symbols: [] });
const graph = (scope: GraphModel['scope'], nodes: GraphNode[]): GraphModel => ({ scope, nodes, edges: [], reviewOrder: [] });

const full = graph('full', [file('web/page.tsx', 'changed'), file('web/card.tsx'), file('lib/db.ts'), file('lib/auth.ts')]);

describe('view registry', () => {
  it('shows Changes file by file and Full System in folders', () => {
    expect(viewKindFor(graph('changes', []))).toBe('files');
    expect(viewKindFor(graph('full', []))).toBe('folders');
  });

  it('offers Routes only when some file has a route, and lets the reader pick among what is offered', () => {
    const plain = graph('full', [file('a.ts')]);
    const routed = graph('full', [{ ...file('app/page.tsx'), route: '/', project: '' }, file('lib/db.ts')]);

    expect(viewsFor(plain).map((v) => v.kind)).toEqual(['folders']);
    expect(viewsFor(routed).map((v) => v.kind)).toEqual(['folders', 'routes']);
    expect(viewKindFor(routed, 'routes')).toBe('routes');
    expect(viewKindFor(plain, 'routes')).toBe('folders'); // not offered: back to the default
    expect(viewKindFor(routed, 'files')).toBe('folders'); // Files is for the Changes scope only
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

describe('routes view', () => {
  const routed = (nodes: GraphNode[]): GraphModel => graph('full', nodes);
  const page = (id: string, route: string, status: GraphNode['status'] = 'unchanged'): GraphNode => ({
    ...file(id, status),
    route,
    project: '',
    entryPoint: 'Next.js page',
  });
  const nodes = [page('app/page.tsx', '/'), page('app/users/page.tsx', '/users', 'changed'), page('app/users/[id]/page.tsx', '/users/[id]'), file('lib/db.ts'), file('lib/auth.ts', 'changed')];
  const g = routed(nodes);
  const initial = routesView.initialState;
  const id = (route: string) => routeNodeId('', route);

  it('draws one card per route, one for the files outside every route, and an arrow from each route to its children', async () => {
    const { nodes: drawn, edges } = await routesView.layout(g, new Set(), initial);

    expect(drawn.map((n) => n.id).sort()).toEqual([OTHER_ID, id('/'), id('/users'), id('/users/[id]')].sort());
    expect(drawn.every((n) => n.type === 'routeCard')).toBe(true);
    expect(edges.map((e) => [e.source, e.target])).toEqual([
      [id('/'), id('/users')],
      [id('/users'), id('/users/[id]')],
    ]);
  });

  it('puts a route to the left of the routes below it', async () => {
    const { nodes: drawn } = await routesView.layout(g, new Set(), initial);
    const x = (route: string) => drawn.find((n) => n.id === id(route))!.position.x;
    expect(x('/')).toBeLessThan(x('/users'));
    expect(x('/users')).toBeLessThan(x('/users/[id]'));
  });

  it('lists only the files that matter to a review in the card of files outside every route', async () => {
    const { nodes: drawn } = await routesView.layout(g, new Set(), initial);
    const other = drawn.find((n) => n.id === OTHER_ID)!;
    expect(other.data).toMatchObject({ title: 'Not in a route', hiddenFiles: 1, changedCount: 1 });
    expect((other.data.files as GraphNode[]).map((f) => f.id)).toEqual(['lib/auth.ts']);
  });

  it('folds the routes below a route and unfolds them again', async () => {
    const folded = routesView.toggleNode(g, initial, id('/users'));
    const { nodes: drawn, edges } = await routesView.layout(g, new Set(), folded);

    expect(drawn.map((n) => n.id)).not.toContain(id('/users/[id]'));
    expect(edges.map((e) => e.target)).not.toContain(id('/users/[id]'));
    expect(drawn.find((n) => n.id === id('/users'))!.data.fold).toEqual({ children: 1, collapsed: true });
    expect(routesView.toggleNode(g, folded, id('/users')).has(id('/users'))).toBe(false);
  });

  it('ignores a click on a card with nothing below it', () => {
    expect(routesView.toggleNode(g, initial, id('/users/[id]'))).toBe(initial);
    expect(routesView.toggleNode(g, initial, OTHER_ID)).toBe(initial);
  });

  it('reveals a file by unfolding the routes above it, and says nothing changed when it is visible already', () => {
    const folded = new Set([id('/'), id('/users')]);
    const revealed = routesView.reveal(g, folded, 'app/users/[id]/page.tsx');
    expect(revealed.size).toBe(0);

    expect(routesView.reveal(g, initial, 'app/users/[id]/page.tsx')).toBe(initial);
    expect(routesView.reveal(g, folded, 'lib/db.ts')).toBe(folded); // outside every route: nothing to unfold
  });

  it('names the card that shows a file', () => {
    expect(routesView.nodeFor(g, 'app/users/page.tsx')).toBe(id('/users'));
    expect(routesView.nodeFor(g, 'lib/db.ts')).toBe(OTHER_ID);
    expect(routesView.nodeFor(g, 'unknown.ts')).toBe('unknown.ts');
  });
});

describe('mainRole', () => {
  const withRole = (role: GraphNode['role']): GraphNode => ({ ...file('x.ts'), ...(role ? { role } : {}) });

  it('picks the role that says most about a route', () => {
    expect(mainRole([withRole('layout'), withRole('page'), withRole('boundary')])).toBe('page');
    expect(mainRole([withRole('layout'), withRole('api')])).toBe('api');
    expect(mainRole([withRole('boundary'), withRole('layout')])).toBe('layout');
  });

  it('is undefined when no file has a role', () => {
    expect(mainRole([withRole(undefined)])).toBeUndefined();
    expect(mainRole([])).toBeUndefined();
  });
});
