import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
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
  );
}

export function deactivate(): void {}
