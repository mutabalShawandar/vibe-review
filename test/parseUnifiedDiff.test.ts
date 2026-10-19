import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../src/changes/parseUnifiedDiff';

describe('parseUnifiedDiff', () => {
  it('reads line ranges of the new file from hunk headers', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -10,2 +10,3 @@ function x() {',
      '@@ -40 +41 @@',
    ].join('\n');

    expect(parseUnifiedDiff(diff)).toEqual([
      {
        path: 'src/a.ts',
        kind: 'modified',
        ranges: [
          { start: 10, end: 12 },
          { start: 41, end: 41 }, // count omitted by git means 1 line
        ],
      },
    ]);
  });

  it('marks a pure deletion on the line before the removed text', () => {
    const diff = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -5,2 +4,0 @@'].join('\n');
    expect(parseUnifiedDiff(diff)[0].ranges).toEqual([{ start: 4, end: 4 }]);
  });

  it('clamps a deletion at the top of the file to line 1', () => {
    const diff = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,2 +0,0 @@'].join('\n');
    expect(parseUnifiedDiff(diff)[0].ranges).toEqual([{ start: 1, end: 1 }]);
  });

  it('detects added and deleted files', () => {
    const diff = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,4 @@',
      'diff --git a/old.ts b/old.ts',
      'deleted file mode 100644',
      '--- a/old.ts',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
    ].join('\n');

    const [added, deleted] = parseUnifiedDiff(diff);
    expect(added).toMatchObject({ path: 'new.ts', kind: 'added', ranges: [{ start: 1, end: 4 }] });
    expect(deleted).toMatchObject({ path: 'old.ts', kind: 'deleted' });
  });

  it('uses the new path for renames and strips the tab git adds after names with spaces', () => {
    const diff = [
      'diff --git a/old name.ts b/new name.ts',
      'similarity index 90%',
      'rename from old name.ts',
      'rename to new name.ts',
      '--- a/old name.ts\t',
      '+++ b/new name.ts\t',
      '@@ -1 +1 @@',
    ].join('\n');

    expect(parseUnifiedDiff(diff)[0].path).toBe('new name.ts');
  });

  it('keeps binary files, which have no hunks', () => {
    const diff = ['diff --git a/logo.png b/logo.png', 'Binary files a/logo.png and b/logo.png differ'].join('\n');
    expect(parseUnifiedDiff(diff)).toEqual([{ path: 'logo.png', kind: 'modified', ranges: [] }]);
  });

  it('returns nothing for empty output', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});
