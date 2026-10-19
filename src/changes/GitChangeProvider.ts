import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ChangeSet, FileChange } from '../core/types';
import { runGit } from '../workspace/git';
import { parseUnifiedDiff } from './parseUnifiedDiff';

/**
 * Asks git "what is different from the last commit right now?" and returns it
 * as a ChangeSet. Covers two sources: edits to tracked files (staged or not)
 * and brand-new files git has not seen yet.
 */
export class GitChangeProvider {
  /** @param root the workspace folder; all returned paths are relative to it. */
  constructor(private readonly root: string) {}

  async getChanges(): Promise<ChangeSet> {
    const [edited, untracked] = await Promise.all([this.readTrackedChanges(), this.readUntrackedFiles()]);
    return [...edited, ...untracked];
  }

  /** Edits to files git already tracks. */
  private async readTrackedChanges(): Promise<FileChange[]> {
    // Before the first commit there is no HEAD to compare against (an "unborn" branch).
    // Then the only tracked files are the staged ones, and `git diff --cached` lists them.
    // Limitation: edits made after staging are not seen until the first commit exists.
    const base = (await this.hasCommits()) ? ['HEAD'] : ['--cached'];

    const diff = await this.git(
      // -U0: no context lines, so hunks cover exactly the changed lines
      // --relative: paths relative to the workspace folder, not the repo root
      // --no-color / --no-ext-diff: keep the output plain text we can parse
      // HEAD: compare the working tree (staged + unstaged edits) to the last commit
      ['diff', '-U0', '--relative', '--no-color', '--no-ext-diff', ...base],
    );
    return parseUnifiedDiff(diff);
  }

  /**
   * True if HEAD exists. Exit code 1 means "no such commit" (empty repo); any other
   * failure (git missing, not a repository) is a real error and is rethrown.
   */
  private async hasCommits(): Promise<boolean> {
    try {
      await this.git(['rev-parse', '--verify', '--quiet', 'HEAD']);
      return true;
    } catch (error) {
      if ((error as { code?: unknown }).code === 1) {
        return false;
      }
      throw error;
    }
  }

  /** New files git does not track yet, respecting .gitignore. They count as fully changed. */
  private async readUntrackedFiles(): Promise<FileChange[]> {
    // -z separates paths with a NUL byte and turns off git's quoting of unusual names,
    // so tabs, quotes, backslashes and newlines in file names come through unchanged.
    const output = await this.git(['ls-files', '--others', '--exclude-standard', '-z']);
    const files = output.split('\0').filter((file) => file.length > 0);

    return Promise.all(
      files.map(async (file) => ({
        path: file,
        kind: 'added' as const,
        ranges: await this.wholeFileRange(file),
      })),
    );
  }

  /**
   * The range covering every line of a file. Empty (but still reported as changed) for
   * files with no readable text: empty files, binaries, symbolic links, and files that
   * vanished between listing and reading. One bad entry must not hide all other changes.
   */
  private async wholeFileRange(file: string): Promise<FileChange['ranges']> {
    try {
      const fullPath = path.join(this.root, file);
      // lstat does not follow links, so a dangling symlink is detected instead of throwing.
      if ((await fs.lstat(fullPath)).isSymbolicLink()) {
        return [];
      }

      const content = await fs.readFile(fullPath);
      if (content.length === 0 || content.includes(0)) {
        return []; // empty file, or a 0 byte means binary: no meaningful lines
      }
      const newlines = content.filter((byte) => byte === 0x0a).length;
      const endsWithNewline = content[content.length - 1] === 0x0a;
      return [{ start: 1, end: endsWithNewline ? newlines : newlines + 1 }];
    } catch {
      return [];
    }
  }

  private git(args: string[]): Promise<string> {
    return runGit(this.root, args);
  }
}
