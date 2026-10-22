import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs file without type declarations
import { bundleOptions } from '../esbuild.config.mjs';

// Unit tests run the source through vitest, which resolves packages differently from the
// real bundle. This test builds the extension exactly like `npm run build` and loads it, so
// problems that only exist in the bundle (like a package that cannot be bundled) show up here.

const dir = mkdtempSync(path.join(tmpdir(), 'vibe-review-bundle-'));
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // best-effort cleanup of a temp folder
  }
});

/** A stand-in for the `vscode` module that records which commands the extension registers. */
function writeVscodeStub(registered: string[]): string {
  const stubPath = path.join(dir, 'vscode-stub.js');
  writeFileSync(
    stubPath,
    `exports.window = { createOutputChannel: () => ({ show() {}, appendLine() {}, dispose() {} }),
        createWebviewPanel: () => ({ webview: {} }), showWarningMessage() {}, activeTextEditor: undefined,
        createTextEditorDecorationType: () => ({ dispose() {} }),
        createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }) };
     exports.commands = { registerCommand: (id) => { globalThis.__registered.push(id); return { dispose() {} }; } };
     exports.workspace = { workspaceFolders: undefined, getWorkspaceFolder: () => undefined };
     exports.ViewColumn = { Active: -1 };
     exports.StatusBarAlignment = { Left: 1 };
     exports.EventEmitter = class { event = () => ({ dispose() {} }); fire() {} dispose() {} };
     exports.OverviewRulerLane = { Left: 1, Center: 2, Right: 4 };`,
  );
  (globalThis as { __registered?: string[] }).__registered = registered;
  return stubPath;
}

describe('bundled extension', () => {
  it('loads and registers its commands', async () => {
    const registered: string[] = [];
    const outfile = path.join(dir, 'extension.js');
    await build({
      ...bundleOptions,
      outfile,
      sourcemap: false,
      // Point `vscode` at the stub instead of leaving it external.
      external: [],
      alias: { ...bundleOptions.alias, vscode: writeVscodeStub(registered) },
      logLevel: 'silent',
    });

    // Loading the file runs the top level of every bundled module, which is where
    // "Cannot find module" errors happen.
    const extension = createRequire(import.meta.url)(outfile);
    extension.activate({ subscriptions: [], extensionPath: dir });

    expect(registered).toEqual(
      expect.arrayContaining(['vibeReview.open', 'vibeReview.logChanges', 'vibeReview.analyzeActiveFile', 'vibeReview.buildGraph']),
    );
  });
});
