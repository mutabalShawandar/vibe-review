import { describe, expect, it } from 'vitest';
import type { GraphModel, GraphNode } from '../src/core/types';
import { folderOf, groupFolders, layoutFolders } from '../webview/src/folders';

const file = (id: string, status: GraphNode['status'] = 'unchanged'): GraphNode => ({ id, language: 'typescript', status, symbols: [] });

const graph: GraphModel = {
  scope: 'full',
  nodes: [
    file('app/api/users/route.ts', 'changed'),
    file('app/api/posts/route.ts'),
    file('app/page.tsx'),
    file('app/layout.tsx'),
    file('lib/db.ts'),
    file('lib/auth/session.ts'),
    file('lib/auth/token.ts'),
    file('index.ts'),
  ],
  edges: [
    { from: 'app/api/users/route.ts', to: 'lib/db.ts', uses: [{}, {}] },
    { from: 'app/api/posts/route.ts', to: 'lib/db.ts', uses: [{}] },
    { from: 'app/page.tsx', to: 'app/layout.tsx', uses: [{}] },
  ],
  reviewOrder: [],
};

describe('folderOf', () => {
  it('names a folder by at most two path segments', () => {
    expect(folderOf('app/api/users/route.ts')).toBe('app/api');
    expect(folderOf('lib/db.ts')).toBe('lib');
    expect(folderOf('index.ts')).toBe('(root)');
  });
});

describe('groupFolders', () => {
  it('merges a folder with a single file into its parent', () => {
    const { folderOfFile } = groupFolders(graph);
    expect(folderOfFile.get('lib/db.ts')).toBe('lib');
    expect(folderOfFile.get('lib/auth/session.ts')).toBe('lib/auth');
    // app/layout.tsx and app/page.tsx share `app`; the two route files share `app/api`
    expect(folderOfFile.get('app/api/users/route.ts')).toBe('app/api');
  });

  it('counts the changed files of a folder', () => {
    const api = groupFolders(graph).folders.find((folder) => folder.id === 'app/api');
    expect(api?.changed).toBe(1);
  });
});

describe('layoutFolders', () => {
  it('draws one arrow per pair of folders, not per file', async () => {
    const { edges } = await layoutFolders(graph);
    // the two route files both use lib/db.ts; page.tsx -> layout.tsx stays inside one folder, so no arrow
    expect(edges.map((edge) => [edge.source, edge.target])).toEqual([['app/api', 'lib']]);
  });
});
