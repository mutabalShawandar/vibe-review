import * as vscode from 'vscode';
import { GitChangeProvider } from '../changes/GitChangeProvider';
import type { ChangeWatcher } from '../workspace/ChangeWatcher';

/**
 * A status bar item that is always there: how many files changed, one click opens the review.
 * It keeps the extension visible without opening anything on its own.
 */
export class ReviewStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  private readonly subscription: vscode.Disposable;

  constructor(watcher: ChangeWatcher) {
    this.item.command = 'vibeReview.open';
    this.subscription = watcher.onDidChange(() => void this.update());
    void this.update();
  }

  private async update(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.item.hide();
      return;
    }
    try {
      const count = (await new GitChangeProvider(folder.uri.fsPath).getChanges()).length;
      this.item.text = `$(git-compare) Vibe Review: ${count} changed`;
      this.item.tooltip = count === 0 ? 'No changes yet. Click to open Vibe Review.' : 'Click to review the changes as a diagram.';
      this.item.show();
    } catch {
      this.item.hide(); // not a git repository, or git is missing
    }
  }

  dispose(): void {
    this.subscription.dispose();
    this.item.dispose();
  }
}
