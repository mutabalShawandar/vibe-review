import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { GraphScope } from '../core/types';
import type { GraphService } from '../workspace/GraphService';
import type { HostMessage, WebviewMessage } from './messages';

/**
 * The "Vibe Review" tab. It only hosts the webview (the React app in /webview) and feeds it
 * graphs; all drawing happens in the webview. There is at most one panel at a time.
 */
export class ReviewPanel {
  private static current: ReviewPanel | undefined;

  /** Open the panel, or bring the existing one to the front. */
  static show(context: vscode.ExtensionContext, graphService: GraphService): void {
    if (ReviewPanel.current) {
      ReviewPanel.current.panel.reveal();
      return;
    }

    const webviewRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel('vibeReview', 'Vibe Review', vscode.ViewColumn.Active, {
      enableScripts: true,
      // Keep the page alive while the tab is in the background, so switching tabs
      // does not reload and re-lay-out the graph.
      retainContextWhenHidden: true,
      // The page may only load files from dist/webview.
      localResourceRoots: [webviewRoot],
    });
    ReviewPanel.current = new ReviewPanel(panel, webviewRoot, graphService);
  }

  // Incremented for every load, so a slow older result cannot overwrite a newer one.
  private loadCounter = 0;
  private scope: GraphScope = 'changes';
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    webviewRoot: vscode.Uri,
    private readonly graphService: GraphService,
  ) {
    panel.webview.html = this.html(webviewRoot);

    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        if (message.type === 'setScope') {
          this.scope = message.scope;
        }
        // "ready" and "setScope" both mean: show me a graph.
        void this.load();
      }),
      panel.onDidDispose(() => {
        ReviewPanel.current = undefined;
        this.disposables.forEach((disposable) => disposable.dispose());
      }),
    );
  }

  private async load(): Promise<void> {
    const loadId = ++this.loadCounter;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.post({ type: 'error', message: 'Open a folder first (File > Open Folder).' });
      return;
    }

    this.post({ type: 'loading', message: 'Analyzing workspace...' });
    try {
      const { graph } = await this.graphService.build(folder.uri.fsPath, this.scope, (done, total) => {
        if (loadId === this.loadCounter) {
          this.post({ type: 'loading', message: `Analyzing workspace... ${done}/${total} files` });
        }
      });
      if (loadId === this.loadCounter) {
        this.post({ type: 'graph', graph });
      }
    } catch (error) {
      if (loadId === this.loadCounter) {
        const reason = error instanceof Error ? error.message : String(error);
        this.post({ type: 'error', message: `Could not build the graph: ${reason}` });
      }
    }
  }

  private post(message: HostMessage): void {
    void this.panel.webview.postMessage(message);
  }

  private html(webviewRoot: vscode.Uri): string {
    const webview = this.panel.webview;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'main.js'));
    const styles = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'main.css'));
    // Only our own script (identified by this one-time nonce) may run.
    const nonce = randomBytes(16).toString('base64');

    // style-src needs 'unsafe-inline' because React Flow positions nodes with inline styles.
    const policy = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="${styles}" />
    <title>Vibe Review</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
  }
}
