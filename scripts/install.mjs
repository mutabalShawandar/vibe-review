// Installs the packaged .vsix into your normal VS Code, so Vibe Review is available in every window.
//
//   npm run install:vscode
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));
const vsix = `${name}-${version}.vsix`;
// `code` is a .cmd file on Windows, which needs a shell to run.
const result = spawnSync(`code --install-extension "${vsix}" --force`, { stdio: 'inherit', shell: true });
if (result.status === 0) {
  console.log('Installed. Reload VS Code, open a git project and run "Vibe Review: Open".');
}
process.exit(result.status ?? 1);
