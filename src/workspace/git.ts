import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Run a git command inside `cwd` and return its output. Rejects if git fails. */
export async function runGit(cwd: string, args: string[]): Promise<string> {
  // core.quotepath=false keeps non-ASCII file names readable instead of "\303\244" escapes.
  const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    maxBuffer: 64 * 1024 * 1024, // big outputs are normal after an AI rewrites many files
  });
  return stdout;
}
