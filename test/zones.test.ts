import { describe, expect, it } from 'vitest';
import type { GraphModel, GraphNode } from '../src/core/types';
import type { FileRole } from '../src/core/FrameworkStrategy';
import { layoutGraph, ZONE_GAP } from '../webview/src/layout';
import { roleRank, zoneOf } from '../webview/src/zones';

const file = (id: string, role?: FileRole): GraphNode => ({
  id,
  language: 'typescript',
  status: 'changed',
  symbols: [],
  ...(role ? { role } : {}),
});

const model = (nodes: GraphNode[], links: [string, string][] = []): GraphModel => ({
  scope: 'full',
  nodes,
  edges: links.map(([from, to]) => ({ from, to, uses: [{}] })),
  reviewOrder: [],
});

describe('zoneOf', () => {
  it('puts what the user sees on top, the server in the middle, shared things last', () => {
    expect(['page', 'ui', 'hook'].map((role) => zoneOf(role as FileRole))).toEqual(['frontend', 'frontend', 'frontend']);
    expect(['api', 'lib'].map((role) => zoneOf(role as FileRole))).toEqual(['backend', 'backend']);
    expect(['types', 'test', 'other'].map((role) => zoneOf(role as FileRole))).toEqual(['shared', 'shared', 'shared']);
  });

  it('sends a file with no role to the shared band', () => {
    expect(zoneOf(undefined)).toBe('shared');
  });

  it('keeps a screen before the components it is built from', () => {
    expect(roleRank('page')).toBeLessThan(roleRank('ui'));
    expect(roleRank('ui')).toBeLessThan(roleRank('hook'));
    expect(roleRank(undefined)).toBe(roleRank('other'));
  });
});

describe('layoutGraph in bands', () => {
  const nodes = [
    file('app/page.tsx', 'page'),
    file('components/Button.tsx', 'ui'),
    file('hooks/useUser.ts', 'hook'),
    file('app/api/users/route.ts', 'api'),
    file('lib/db.ts', 'lib'),
    file('types/user.ts', 'types'),
  ];
  const links: [string, string][] = [
    ['app/page.tsx', 'components/Button.tsx'],
    ['app/page.tsx', 'hooks/useUser.ts'],
    ['hooks/useUser.ts', 'app/api/users/route.ts'], // an arrow from the frontend into the backend
    ['app/api/users/route.ts', 'lib/db.ts'],
    ['lib/db.ts', 'types/user.ts'],
  ];

  const bounds = async (g: GraphModel, ids: string[]) => {
    const laidOut = await layoutGraph(g);
    const boxes = laidOut.nodes.filter((n) => ids.includes(n.id));
    return {
      top: Math.min(...boxes.map((n) => n.position.y)),
      bottom: Math.max(...boxes.map((n) => n.position.y + (n.height ?? 0))),
    };
  };

  it('stacks frontend above backend above shared, with a gap between them', async () => {
    const g = model(nodes, links);
    const frontend = await bounds(g, ['app/page.tsx', 'components/Button.tsx', 'hooks/useUser.ts']);
    const backend = await bounds(g, ['app/api/users/route.ts', 'lib/db.ts']);
    const shared = await bounds(g, ['types/user.ts']);

    expect(backend.top - frontend.bottom).toBeGreaterThanOrEqual(ZONE_GAP);
    expect(shared.top - backend.bottom).toBeGreaterThanOrEqual(ZONE_GAP);
  });

  it('keeps imported files to the left of their importers inside a band', async () => {
    const at = Object.fromEntries((await layoutGraph(model(nodes, links))).nodes.map((n) => [n.id, n.position]));
    expect(at['components/Button.tsx']!.x).toBeLessThan(at['app/page.tsx']!.x);
    expect(at['lib/db.ts']!.x).toBeLessThan(at['app/api/users/route.ts']!.x);
  });

  it('draws arrows between bands', async () => {
    const { edges } = await layoutGraph(model(nodes, links));
    expect(edges.some((e) => e.source === 'hooks/useUser.ts' && e.target === 'app/api/users/route.ts')).toBe(true);
  });

  it('skips a band that has no files, so there is no empty gap', async () => {
    const g = model([file('app/page.tsx', 'page'), file('types/user.ts', 'types')]);
    const frontend = await bounds(g, ['app/page.tsx']);
    const shared = await bounds(g, ['types/user.ts']);
    expect(shared.top - frontend.bottom).toBeGreaterThanOrEqual(ZONE_GAP);
    expect(shared.top - frontend.bottom).toBeLessThan(ZONE_GAP * 2);
  });

  it('lays everything out as one diagram when grouping is turned off', async () => {
    const withRoles = model(nodes, links);
    const withoutRoles = model(nodes.map(({ role: _role, ...rest }) => rest), links);
    const positions = async (g: GraphModel, groupByRole: boolean) =>
      Object.fromEntries((await layoutGraph(g, new Set(), { groupByRole })).nodes.map((n) => [n.id, n.position]));
    expect(await positions(withRoles, false)).toEqual(await positions(withoutRoles, true));
  });

  it('never lets two cards overlap across bands', async () => {
    const many = Array.from({ length: 24 }, (_, i) =>
      file(`f${i}.ts`, (['page', 'ui', 'hook', 'api', 'lib', 'types'] as FileRole[])[i % 6]),
    );
    const { nodes: placed } = await layoutGraph(model(many));
    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) {
        const apart =
          a.position.x + 340 <= b.position.x || b.position.x + 340 <= a.position.x ||
          a.position.y + (a.height ?? 0) <= b.position.y || b.position.y + (b.height ?? 0) <= a.position.y;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
    }
  });
});
