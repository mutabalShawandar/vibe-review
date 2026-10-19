import * as path from 'node:path';
import * as vscode from 'vscode';
import { GitChangeProvider } from './changes/GitChangeProvider';
import { ParserLoader } from './parser/ParserLoader';

// Temporary (step 4a): which grammar file parses which extension. Replaced by the
// strategy registry in step 4b/4c.
const DEBUG_GRAMMARS: Record<string, string> = {
  '.ts': 'tree-sitter-typescript.wasm',
  '.tsx': 'tree-sitter-tsx.wasm',
  '.py': 'tree-sitter-python.wasm',
};

export function activate(context: vscode.ExtensionContext): void {
  // The "Vibe Review" tab in the Output panel; we log what the extension finds there.
  const output = vscode.window.createOutputChannel('Vibe Review');
  context.subscriptions.push(output);

  // The .wasm files are copied to dist/grammars by the build (see esbuild.mjs).
  const parser = new ParserLoader((fileName) => path.join(context.extensionPath, 'dist', 'grammars', fileName));

  context.subscriptions.push(
    vscode.commands.registerCommand('vibeReview.open', () => {
      const panel = vscode.window.createWebviewPanel(
        'vibeReview',
        'Vibe Review',
        vscode.ViewColumn.Active,
        {},
      );
      panel.webview.html = '<!doctype html><html><body><h1>Vibe Review</h1><p>No graph yet.</p></body></html>';
    }),

    // Temporary step 3 command: prints git's view of the changes so we can verify them.
    vscode.commands.registerCommand('vibeReview.logChanges', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage('Vibe Review: open a folder first.');
        return;
      }

      output.show(true); // reveal the channel without stealing focus from the editor
      output.appendLine(`--- Changes in ${folder.uri.fsPath} ---`);
      try {
        const changes = await new GitChangeProvider(folder.uri.fsPath).getChanges();
        if (changes.length === 0) {
          output.appendLine('(no changes)');
        }
        for (const change of changes) {
          const ranges = change.ranges.map((r) => `${r.start}-${r.end}`).join(', ');
          output.appendLine(`${change.kind.padEnd(8)} ${change.path}  [${ranges}]`);
        }
      } catch (error) {
        // Most likely git is missing or the folder is not a git repository.
        output.appendLine(`Failed to read git changes: ${error instanceof Error ? error.message : error}`);
      }
    }),

    // Temporary step 4a command: proves the WASM parser loads and runs inside the extension.
    vscode.commands.registerCommand('vibeReview.parseActiveFile', async () => {
      const document = vscode.window.activeTextEditor?.document;
      output.show(true);
      if (!document) {
        output.appendLine('Open a .ts, .tsx or .py file first.');
        return;
      }

      const grammar = DEBUG_GRAMMARS[path.extname(document.fileName).toLowerCase()];
      if (!grammar) {
        output.appendLine(`No grammar for ${document.fileName}`);
        return;
      }

      try {
        const started = Date.now();
        const tree = await parser.parse(grammar, document.getText());
        try {
          const root = tree.rootNode;
          output.appendLine(
            `Parsed ${path.basename(document.fileName)} with ${grammar} in ${Date.now() - started} ms: ` +
              `root=${root.type}, top-level nodes=${root.namedChildCount}, syntax errors=${root.hasError}`,
          );
        } finally {
          tree.delete(); // free WASM memory, even if reading the tree or logging threw
        }
      } catch (error) {
        output.appendLine(`Parse failed: ${error instanceof Error ? error.stack : error}`);
      }
    }),
  );
}

export function deactivate(): void {}
