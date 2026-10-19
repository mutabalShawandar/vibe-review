import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitChangeProvider } from '../src/changes/GitChangeProvider';

// These tests run real git in a throwaway repository.
let dir: string;
const git = (...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], { cwd: dir, stdio: 'pipe' });
const write = (file: string, content: string) => writeFileSync(path.join(dir, file), content);

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'vibe-review-'));
  git('init', '-q');
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));

describe('GitChangeProvider', () => {
  it('reports staged files in a repository with no commits yet', async () => {
    write('a.ts', 'one\ntwo\n');
    git('add', 'a.ts');

    const changes = await new GitChangeProvider(dir).getChanges();
    expect(changes).toEqual([{ path: 'a.ts', kind: 'added', ranges: [{ start: 1, end: 2 }] }]);
  });

  it('reports edits to tracked files and new untracked files', async () => {
    write('a.ts', 'one\ntwo\n');
    git('add', 'a.ts');
    git('commit', '-q', '-m', 'init');
    write('a.ts', 'one\nTWO\n');
    write('b.ts', 'new');

    const changes = await new GitChangeProvider(dir).getChanges();
    expect(changes).toEqual([
      { path: 'a.ts', kind: 'modified', ranges: [{ start: 2, end: 2 }] },
      { path: 'b.ts', kind: 'added', ranges: [{ start: 1, end: 1 }] },
    ]);
  });

  it('returns untracked files with non-ASCII names unchanged', async () => {
    write('café.ts', 'x\n');

    const changes = await new GitChangeProvider(dir).getChanges();
    expect(changes.map((c) => c.path)).toEqual(['café.ts']);
    expect(changes[0].ranges).toEqual([{ start: 1, end: 1 }]);
  });

  it('keeps all changes when an untracked symlink points nowhere', async (ctx) => {
    try {
      symlinkSync('missing-target', path.join(dir, 'broken-link'));
    } catch {
      ctx.skip(); // creating symlinks needs special rights on Windows
    }
    write('b.ts', 'new\n');

    const changes = await new GitChangeProvider(dir).getChanges();
    expect(changes.map((c) => c.path).sort()).toEqual(['b.ts', 'broken-link']);
    expect(changes.find((c) => c.path === 'broken-link')?.ranges).toEqual([]);
  });

  it('rethrows when the folder is not a git repository', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'vibe-review-nogit-'));
    try {
      await expect(new GitChangeProvider(outside).getChanges()).rejects.toThrow();
    } finally {
      try {
        rmSync(outside, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        // best-effort cleanup of an empty temp folder; Windows may briefly lock it
      }
    }
  });
});
