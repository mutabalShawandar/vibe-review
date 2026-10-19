// How the extension is bundled. Shared by the build (esbuild.mjs) and by the test that
// loads the real bundle (test/bundle.test.ts), so both always use identical settings.
export const bundleOptions = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  // Tree-sitter query files are bundled into the extension as plain strings.
  loader: { '.scm': 'text' },
  alias: {
    // web-tree-sitter ships an ESM and a CommonJS build. esbuild would pick the ESM one,
    // which uses `import.meta.url` and crashes inside our CommonJS bundle. Force the CJS one.
    'web-tree-sitter': './node_modules/web-tree-sitter/tree-sitter.cjs',
    // jsonc-parser's default (UMD) build loads its parts with dynamic require() calls that
    // cannot be bundled ("Cannot find module './impl/format'" at startup). Use its ESM build.
    'jsonc-parser': './node_modules/jsonc-parser/lib/esm/main.js',
  },
  sourcemap: true,
};

// The React app shown inside the review panel. It runs in a browser-like webview, not in Node,
// and is loaded by the panel as dist/webview/main.js plus dist/webview/main.css.
export const webviewOptions = {
  entryPoints: { main: 'webview/src/main.tsx' },
  outdir: 'dist/webview',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  loader: { '.css': 'css' },
  // React switches to its smaller production build for this value.
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  sourcemap: true,
};
