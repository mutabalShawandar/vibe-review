// Folders whose files change constantly without being part of the review: dependencies, build
// output, caches, version-control internals. A change inside one of them never triggers a refresh.
const NOISE_FOLDERS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.pytest_cache',
  '.mypy_cache',
]);

// Git's own files that do change what the review shows: a commit, a checkout or `git add` moves
// the baseline or the index, so the diff changes without any source file being edited.
const GIT_STATE_FILES = new Set(['.git/HEAD', '.git/index']);

/** Whether a change at this workspace-relative path (forward slashes) should refresh the review. */
export function isRelevantChange(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  if (GIT_STATE_FILES.has(normalized)) {
    return true;
  }
  return !normalized.split('/').some((part) => NOISE_FOLDERS.has(part));
}
