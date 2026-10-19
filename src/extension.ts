import * as vscode from 'vscode';
import { GitChangeProvider } from './changes/GitChangeProvider';

export function activate(context: vscode.ExtensionContext): void {
  // The "Vibe Review" tab in the Output panel; we log what the extension finds there.
  const output = vscode.window.createOutputChannel('Vibe Review');
  context.subscriptions.push(output);

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
  );
}

export function deactivate(): void {}
