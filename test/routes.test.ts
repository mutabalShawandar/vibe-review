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
  file('app/users/[id]/page.tsx', '/users/[id]', 'Next.js page'),
  file('app/users/[id]/layout.tsx', '/users/[id]', 'Next.js layout'),
  file('app/api/users/route.ts', '/api/users', 'Next.js route handler'),
  file('lib/db.ts'),
];

describe('buildRouteTree', () => {
  const tree = buildRouteTree(files);
  const id = (route: string) => routeNodeId('', route);

  it('makes a node for every segment, including the ones nobody wrote a file for', () => {
    expect([...tree.nodes.keys()].sort()).toEqual(
      ['/', '/api', '/api/users', '/users', '/users/[id]'].map(id).sort(),
    );
    expect(tree.nodes.get(id('/users'))!.files).toEqual([]);
  });

  it('links each segment to its parent and its children, sorted', () => {
    expect(tree.roots).toEqual([id('/')]);
    expect(tree.nodes.get(id('/'))!.children).toEqual([id('/api'), id('/users')]);
    expect(tree.nodes.get(id('/users/[id]'))!.parent).toBe(id('/users'));
    expect(tree.nodes.get(id('/'))!.parent).toBeUndefined();
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
    expect(visibleRoutes(tree, new Set()).map((n) => n.route)).toEqual(['/', '/api', '/api/users', '/users', '/users/[id]']);
    expect(visibleRoutes(tree, new Set([id('/users')])).map((n) => n.route)).toEqual(['/', '/api', '/api/users', '/users']);
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
