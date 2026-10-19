import { context, build } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { bundleOptions, webviewOptions } from './esbuild.config.mjs';

// Every .wasm file the extension needs at runtime, copied next to the bundle.
// Adding a language: add its grammar file name here (they all come from tree-sitter-wasms).
const GRAMMARS = ['tree-sitter-typescript.wasm', 'tree-sitter-tsx.wasm', 'tree-sitter-python.wasm'];

function copyWasmFiles() {
  const copies = [
    // The tree-sitter runtime itself.
    ['node_modules/web-tree-sitter/tree-sitter.wasm', 'dist/grammars/tree-sitter.wasm'],
    ...GRAMMARS.map((file) => [`node_modules/tree-sitter-wasms/out/${file}`, `dist/grammars/${file}`]),
  ];

  // Check everything first so a missing file gives one clear message instead of a raw ENOENT.
  const missing = copies.map(([from]) => from).filter((from) => !existsSync(from));
  if (missing.length > 0) {
    console.error(`Missing files needed for the build:\n  ${missing.join('\n  ')}\nRun "npm install" and try again.`);
    process.exit(1);
  }

  mkdirSync('dist/grammars', { recursive: true });
  for (const [from, to] of copies) {
    copyFileSync(from, to);
  }
}

copyWasmFiles();

if (process.argv.includes('--watch')) {
  for (const options of [bundleOptions, webviewOptions]) {
    const ctx = await context(options);
    await ctx.watch();
  }
  console.log('watching...');
} else {
  await Promise.all([build(bundleOptions), build(webviewOptions)]);
}
