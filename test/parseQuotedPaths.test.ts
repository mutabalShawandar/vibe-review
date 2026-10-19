import { describe, expect, it } from 'vitest';
import { decodeGitPath, parseUnifiedDiff } from '../src/changes/parseUnifiedDiff';

// String.raw keeps backslashes exactly as git prints them.
const raw = String.raw;

describe('decodeGitPath', () => {
  it('returns unquoted paths unchanged', () => {
    expect(decodeGitPath('src/a.ts')).toBe('src/a.ts');
  });

  it('decodes octal bytes as UTF-8', () => {
    expect(decodeGitPath(raw`"caf\303\251.ts"`)).toBe('café.ts');
  });

  it('decodes tab, newline, quote and backslash escapes', () => {
    expect(decodeGitPath(raw`"a\tb\nc\"d\\e"`)).toBe('a\tb\nc"d\\e');
  });
});

describe('parseUnifiedDiff with git-quoted paths', () => {
  // The first section is real `git diff` output (default core.quotepath) for "café.ts".
  it('decodes octal-escaped names and does not merge the next section into them', () => {
    const diff = [
      raw`diff --git "a/caf\303\251.ts" "b/caf\303\251.ts"`,
      'index 422c2b7..7be73ce 100644',
      raw`--- "a/caf\303\251.ts"`,
      raw`+++ "b/caf\303\251.ts"`,
      '@@ -2 +2,2 @@ a',
      'diff --git a/my file.ts b/my file.ts',
      '--- a/my file.ts\t',
      '+++ b/my file.ts\t',
      '@@ -1 +1 @@',
    ].join('\n');

    const [cafe, spaced] = parseUnifiedDiff(diff);
    expect(cafe).toMatchObject({ path: 'café.ts', ranges: [{ start: 2, end: 3 }] });
    expect(spaced).toMatchObject({ path: 'my file.ts', ranges: [{ start: 1, end: 1 }] });
  });

  it('decodes names with tab, quote and backslash', () => {
    const quoted = raw`"we\tird \"q\" \\x.ts"`;
    const diff = [
      `diff --git "a/${quoted.slice(1)} "b/${quoted.slice(1)}`,
      `--- "a/${quoted.slice(1)}`,
      `+++ "b/${quoted.slice(1)}`,
      '@@ -1 +1 @@',
    ].join('\n');

    expect(parseUnifiedDiff(diff)[0].path).toBe('we\tird "q" \\x.ts');
  });

  it('reads quoted names of binary and deleted files', () => {
    const diff = [
      raw`diff --git "a/\303\251.png" "b/\303\251.png"`,
      raw`Binary files "a/\303\251.png" and "b/\303\251.png" differ`,
      raw`diff --git "a/\303\251.ts" "b/\303\251.ts"`,
      'deleted file mode 100644',
      raw`--- "a/\303\251.ts"`,
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
    ].join('\n');

    expect(parseUnifiedDiff(diff).map((c) => [c.path, c.kind])).toEqual([
      ['é.png', 'modified'],
      ['é.ts', 'deleted'],
    ]);
  });

  it('handles a quoted old path with a plain new path', () => {
    const diff = [raw`diff --git "a/\303\251.ts" b/e.ts`, '@@ -1 +1 @@'].join('\n');
    expect(parseUnifiedDiff(diff)[0].path).toBe('e.ts');
  });
});
