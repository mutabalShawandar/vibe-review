import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../src/core/types';
import { groupNodes } from '../webview/src/groups';

const node = (id: string): GraphNode => ({ id, language: 'typescript', status: 'unchanged', symbols: [] });

describe('groupNodes', () => {
  it('puts each file into the box of its parent folder', () => {
    const groups = groupNodes([node('src/lib/db.ts'), node('src/lib/auth.ts'), node('src/app/page.tsx')]);

    expect(groups.map((g) => [g.key, g.ids])).toEqual([
      ['src/app', ['src/app/page.tsx']],
      ['src/lib', ['src/lib/db.ts', 'src/lib/auth.ts']],
    ]);
  });

  it('keeps same-named folders apart and labels them with enough path to tell them apart', () => {
    const groups = groupNodes([node('web/components/A.tsx'), node('admin/components/B.tsx'), node('src/lib/db.ts')]);

    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['admin/components', 'admin/components'],
      ['src/lib', 'lib'],
      ['web/components', 'web/components'],
    ]);
  });

  it('names a folder by its last segment when nothing else shares it', () => {
    const [group] = groupNodes([node('apps/web/src/components/Button.tsx')]);
    expect(group.label).toBe('components');
  });

  it('puts files at the workspace root into one box', () => {
    const [group] = groupNodes([node('package.json.ts'), node('vite.config.ts')]);
    expect(group).toMatchObject({ key: '', label: '(root)', ids: ['package.json.ts', 'vite.config.ts'] });
  });

  it('accepts another rule for choosing the box', () => {
    const groups = groupNodes([node('a/x.ts'), node('b/y.ts')], () => 'everything');
    expect(groups).toHaveLength(1);
    expect(groups[0].ids).toEqual(['a/x.ts', 'b/y.ts']);
  });

  it('returns no boxes for no files', () => {
    expect(groupNodes([])).toEqual([]);
  });
});
