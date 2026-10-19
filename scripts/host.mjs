// Builds the extension and opens a VS Code window that runs it, with no debugger attached
// (so F5's "extension host did not start in 10 seconds" cannot happen).
//
//   npm run host                          opens this repository
//   npm run host -- "C:\path\to\project"  opens another project, e.g. a Next.js app to review
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const projectToOpen = path.resolve(process.argv[2] ?? '.');

const build = spawnSync(process.execPath, ['esbuild.mjs'], { stdio: 'inherit' });
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

// Other extensions are disabled so a heavy one cannot slow down or interfere with the test window.
const args = [
  `--extensionDevelopmentPath=${path.resolve('.')}`,
  '--disable-extensions',
  '--disable-extension=GitHub.copilot-chat',
  '--disable-extension=GitHub.copilot',
  '--new-window',
  projectToOpen,
];
console.log(`Opening ${projectToOpen} with the extension loaded...`);
// `code` is a .cmd file on Windows, which needs a shell to run. Node warns when an argument
// list is combined with a shell, so the quoted command is built here as one string.
const quote = (arg) => `"${arg.replaceAll('"', '\\"')}"`;
spawnSync(`code ${args.map(quote).join(' ')}`, { stdio: 'inherit', shell: true });
