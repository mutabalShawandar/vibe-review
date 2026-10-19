import { build } from 'esbuild';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs file without type declarations
import { webviewOptions } from '../esbuild.config.mjs';

const dir = mkdtempSync(path.join(tmpdir(), 'vibe-review-webview-'));
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // best-effort cleanup of a temp folder
  }
});

describe('webview bundle', () => {
  it('builds with the same settings as `npm run build` and produces the files the panel loads', async () => {
    await build({ ...webviewOptions, outdir: dir, sourcemap: false, logLevel: 'silent' });

    // ReviewPanel loads exactly these two files.
    expect(existsSync(path.join(dir, 'main.js'))).toBe(true);
    expect(existsSync(path.join(dir, 'main.css'))).toBe(true);

    // The page has no Node, so the bundle must not depend on it.
    const script = readFileSync(path.join(dir, 'main.js'), 'utf8');
    expect(script).not.toMatch(/require\(["']node:/);
  });
});
