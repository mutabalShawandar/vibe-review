import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../src/core/types';
import { ancestorsOf, buildRouteTree, OTHER_ID, routeNodeId, routeOfFile, visibleRoutes } from '../webview/src/routes';

const file = (id: string, route?: string, entryPoint?: string, project = '', status: GraphNode['status'] = 'unchanged'): GraphNode => ({
  id,
  language: 'typescript',
  status,
  symbols: [],
  ...(route !== undefined ? { route, project } : {}),
  ...(entryPoint ? { entryPoint } : {}),
});

const files = [
  file('app/layout.tsx', '/', 'Next.js layout'),
  file('app/page.tsx', '/', 'Next.js page'),
  file('app/users/page.tsx', '/users', 'Next.js page'),
  file('app/users/[id]/page.tsx', '/users/[id]', 'Next.js page'),
  file('app/users/[id]/layout.tsx', '/users/[id]', 'Next.js layout'),
  file('app/api/users/route.ts', '/api/users', 'Next.js route handler'),
  file('lib/db.ts'),
];

describe('buildRouteTree', () => {
  const tree = buildRouteTree(files);
  const id = (route: string) => routeNodeId('', route);

  it('makes a node for every route that has files', () => {
    expect([...tree.nodes.keys()].sort()).toEqual(['/', '/api/users', '/users', '/users/[id]'].map(id).sort());
  });

  it('links each segment to its parent and its children, sorted', () => {
    expect(tree.roots).toEqual([id('/')]);
    expect(tree.nodes.get(id('/'))!.children).toEqual([id('/api/users'), id('/users')]);
    expect(tree.nodes.get(id('/users/[id]'))!.parent).toBe(id('/users'));
    expect(tree.nodes.get(id('/'))!.parent).toBeUndefined();
  });

  it('folds a run of empty segments into the route it leads to, and names the route with all of them', () => {
    // "/api" has no file and one route below it: the card is "api/users", not an empty "api" in front of "users"
    const api = tree.nodes.get(id('/api/users'))!;
    expect(api.segment).toBe('api/users');
    expect(api.parent).toBe(id('/'));
    expect(tree.nodes.has(id('/api'))).toBe(false);

    const deep = buildRouteTree([file('app/page.tsx', '/'), file('app/a/b/[c]/route.ts', '/a/b/[c]', 'Next.js route handler')]);
    expect(deep.nodes.get(id('/a/b/[c]'))!.segment).toBe('a/b/[c]');
    expect([...deep.nodes.keys()].sort()).toEqual(['/', '/a/b/[c]'].map(id).sort());
  });

  it('keeps an empty segment that branches, and the root even when it has no file', () => {
    const branching = buildRouteTree([file('app/shop/a/page.tsx', '/shop/a', 'Next.js page'), file('app/shop/b/page.tsx', '/shop/b', 'Next.js page')]);

    expect([...branching.nodes.keys()].sort()).toEqual(['/', '/shop', '/shop/a', '/shop/b'].map(id).sort());
    expect(branching.nodes.get(id('/shop'))!.children).toEqual([id('/shop/a'), id('/shop/b')]);
    expect(branching.nodes.get(id('/'))!.segment).toBe('/'); // "/" has one child and no file, and is still there
  });

  it('lists the files of a route in the order a request meets them', () => {
    expect(tree.nodes.get(id('/users/[id]'))!.files.map((f) => f.id)).toEqual([
      'app/users/[id]/layout.tsx',
      'app/users/[id]/page.tsx',
    ]);
  });

  it('keeps files without a route apart', () => {
    expect(tree.other.map((f) => f.id)).toEqual(['lib/db.ts']);
  });

  it('keeps the same route of two projects apart', () => {
    const two = buildRouteTree([file('web/app/page.tsx', '/', 'Next.js page', 'web'), file('admin/app/page.tsx', '/', 'Next.js page', 'admin')]);
    expect(two.roots).toEqual([routeNodeId('admin', '/'), routeNodeId('web', '/')]);
  });

  it('is empty for no files', () => {
    expect(buildRouteTree([])).toEqual({ nodes: new Map(), roots: [], other: [] });
  });
});

describe('tree queries', () => {
  const tree = buildRouteTree(files);
  const id = (route: string) => routeNodeId('', route);

  it('hides everything below a collapsed route', () => {
    expect(visibleRoutes(tree, new Set()).map((n) => n.route)).toEqual(['/', '/api/users', '/users', '/users/[id]']);
    expect(visibleRoutes(tree, new Set([id('/users')])).map((n) => n.route)).toEqual(['/', '/api/users', '/users']);
    expect(visibleRoutes(tree, new Set([id('/')])).map((n) => n.route)).toEqual(['/']);
  });

  it('lists the routes above one, nearest first', () => {
    expect(ancestorsOf(tree, id('/users/[id]'))).toEqual([id('/users'), id('/')]);
    expect(ancestorsOf(tree, id('/'))).toEqual([]);
  });

  it('finds the route of a file', () => {
    expect(routeOfFile(tree, 'app/api/users/route.ts')?.route).toBe('/api/users');
    expect(routeOfFile(tree, 'lib/db.ts')).toBeUndefined();
  });

  it('names the card for files outside every route', () => {
    expect(OTHER_ID).toBe('route:other');
  });
});
