import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Some tests bundle the whole extension or run real git, which can take a while on a busy machine.
  test: { testTimeout: 30_000 },
  plugins: [
    {
      // Mirrors esbuild's `text` loader for .scm query files, so tests can import them as strings.
      name: 'scm-as-text',
      load(id) {
        if (id.endsWith('.scm')) {
          return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
        }
      },
    },
  ],
});
