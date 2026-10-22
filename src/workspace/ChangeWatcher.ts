import * as vscode from 'vscode';
import { Debouncer } from './Debouncer';
import { isRelevantChange } from './ignoredPaths';

// Wait for this long without a new file change before refreshing; an agent writing several files
// in a row causes one refresh. During constant writing a refresh still happens every MAX_WAIT_MS.
const QUIET_MS = 600;
const MAX_WAIT_MS = 4000;

/**
 * Tells the rest of the extension that the workspace changed, whoever changed it: an agent, a
 * formatter, `git checkout` or the user. It watches the files on disk (and git's HEAD and index),
 * so it works with any tool that writes files; it knows nothing about specific agents.
 */
export class ChangeWatcher implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  /** Fires once per burst of file changes, after things have been quiet for a moment. */
  readonly onDidChange = this.emitter.event;

  private readonly debouncer = new Debouncer(() => this.emitter.fire(), QUIET_MS, MAX_WAIT_MS);
  private readonly disposables: vscode.Disposable[] = [this.emitter, this.debouncer];

  constructor() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/*'));
    const changed = (uri: vscode.Uri) => {
      if (isRelevantChange(vscode.workspace.asRelativePath(uri, false))) {
        this.debouncer.trigger();
      }
    };
    this.disposables.push(watcher, watcher.onDidCreate(changed), watcher.onDidChange(changed), watcher.onDidDelete(changed));
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
  }
}
