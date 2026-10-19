// Lets TypeScript understand `import source from './x.scm'`.
// The build (esbuild `text` loader) and the tests (see vitest.config.ts) turn the file into a string.
declare module '*.scm' {
  const source: string;
  export default source;
}
