import { context, build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

// Every .wasm file the extension needs at runtime, copied next to the bundle.
// Adding a language: add its grammar file name here (they all come from tree-sitter-wasms).
const GRAMMARS = ['tree-sitter-typescript.wasm', 'tree-sitter-tsx.wasm', 'tree-sitter-python.wasm'];

function copyWasmFiles() {
  mkdirSync('dist/grammars', { recursive: true });
  // The tree-sitter runtime itself.
  copyFileSync('node_modules/web-tree-sitter/tree-sitter.wasm', 'dist/grammars/tree-sitter.wasm');
  for (const file of GRAMMARS) {
    copyFileSync(`node_modules/tree-sitter-wasms/out/${file}`, `dist/grammars/${file}`);
  }
}

const options = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  // web-tree-sitter ships an ESM and a CommonJS build. esbuild would pick the ESM one,
  // which uses `import.meta.url` and crashes inside our CommonJS bundle. Force the CJS one.
  alias: { 'web-tree-sitter': './node_modules/web-tree-sitter/tree-sitter.cjs' },
  sourcemap: true,
};

copyWasmFiles();

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('watching...');
} else {
  await build(options);
}
