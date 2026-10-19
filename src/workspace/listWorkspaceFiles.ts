import { runGit } from './git';

/**
 * Every file in the workspace that git knows about or would add, so .gitignore is
 * respected for free (node_modules, build output and so on never show up).
 * Paths are relative to `root` with forward slashes.
 */
export async function listWorkspaceFiles(root: string): Promise<string[]> {
  // --cached: files git tracks.  --others --exclude-standard: new files that are not ignored.
  // -z: separate paths with a NUL byte so unusual file names stay intact.
  const output = await runGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  return [...new Set(output.split('\0').filter((file) => file.length > 0))];
}
