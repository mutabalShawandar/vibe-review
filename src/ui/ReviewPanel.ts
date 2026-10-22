import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { ChangeSet, GraphScope } from '../core/types';
import type { GraphService } from '../workspace/GraphService';
import type { CodeHighlight, CodeSite, HostMessage, WebviewMessage } from './messages';

// How the code is marked while a symbol is selected in the graph. The colors match the rows in
// the graph: blue is what the selected symbol uses, orange is what uses it, green is changed code.
const changedMark = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(46, 160, 67, 0.18)',
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: 'rgba(46, 160, 67, 0.9)',
  overviewRulerColor: 'rgba(46, 160, 67, 0.9)',
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});
const usesMark = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(55, 148, 255, 0.16)',
  overviewRulerColor: 'rgba(55, 148, 255, 0.9)',
  overviewRulerLane: vscode.OverviewRulerLane.Center,
});
const usedByMark = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(224, 138, 30, 0.16)',
  overviewRulerColor: 'rgba(224, 138, 30, 0.9)',
  overviewRulerLane: vscode.OverviewRulerLane.Right,
});
// The symbol that was clicked in the graph (purple), and the exact lines that depend on a change (stronger blue / orange).
const selfMark = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(155, 89, 255, 0.14)',
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: 'rgba(155, 89, 255, 0.95)',
});
const usesSiteMark = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(55, 148, 255, 0.38)',
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: 'rgba(55, 148, 255, 1)',
});
const usedBySiteMark = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(224, 138, 30, 0.38)',
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: 'rgba(224, 138, 30, 1)',
});

/** At most this many connected files are opened in tabs after a click; the rest are marked only if already open. */
const MAX_OPENED_NEIGHBORS = 4;

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
  // The git changes of the last graph, and the symbols currently marked in the code.
  private changes: ChangeSet = [];
  private marks:
    | { origin: string; file: string; line: number; endLine: number; highlights: CodeHighlight[]; sites: CodeSite[] }
    | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    webviewRoot: vscode.Uri,
    private readonly graphService: GraphService,
  ) {
    panel.webview.html = this.html(webviewRoot);

    this.disposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        if (message.type === 'open') {
          void this.openInEditor(message);
          return;
        }
        if (message.type === 'setScope') {
          this.scope = message.scope;
        }
        // "ready" and "setScope" both mean: show me a graph.
        void this.load();
      }),
      // A marked file can come into view later (a tab switch, a file the user opens): mark it too.
      vscode.window.onDidChangeVisibleTextEditors(() => this.applyMarks()),
      panel.onDidDispose(() => {
        this.clearMarks();
        ReviewPanel.current = undefined;
        this.disposables.forEach((disposable) => disposable.dispose());
      }),
    );
  }

  private resolve(file: string): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return undefined;
    }
    const uri = vscode.Uri.joinPath(folder.uri, file);
    // The path comes from the webview; never open anything outside the workspace.
    return uri.fsPath.startsWith(folder.uri.fsPath) ? uri : undefined;
  }

  /**
   * A symbol was clicked in the graph: select it in the editor beside the graph, open the files
   * one arrow away (without taking focus), and mark the changed lines and the connected symbols.
   */
  private async openInEditor(message: Extract<WebviewMessage, { type: 'open' }>): Promise<void> {
    const uri = this.resolve(message.file);
    if (!uri) {
      return;
    }
    const first = Math.max(0, message.line - 1);
    const last = Math.max(first, (message.endLine ?? message.line) - 1);
    let base: vscode.ViewColumn;
    try {
      // The cursor goes to the start of the symbol instead of selecting it; the symbol is marked with
      // a color (below), so the code stays readable and the selection is free for the reader.
      const editor = await vscode.window.showTextDocument(uri, {
        viewColumn: vscode.ViewColumn.Beside, // keep the graph visible
        selection: new vscode.Range(first, 0, first, 0),
      });
      editor.revealRange(new vscode.Range(first, 0, last, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      base = editor.viewColumn ?? vscode.ViewColumn.Beside;
    } catch {
      void vscode.window.showWarningMessage(`Could not open ${message.file} (deleted or not a text file?).`);
      return;
    }

    this.marks = {
      origin: message.origin,
      file: message.file,
      line: message.line,
      endLine: message.endLine ?? message.line,
      highlights: message.highlights,
      sites: message.sites,
    };

    // What the symbol uses opens in the column after it, what uses the symbol in the one after that,
    // both at once. Without focus, so the clicked symbol stays where the reader is looking.
    const next = (offset: number) => Math.min(9, (typeof base === 'number' && base > 0 ? base : 2) + offset) as vscode.ViewColumn;
    await Promise.all([
      this.openNeighbors(message, 'uses', next(1)),
      this.openNeighbors(message, 'usedBy', next(2)),
    ]);
    this.applyMarks();
  }

  /** Open the files one arrow away with the given role as tabs of one column, each scrolled to the connected symbol. */
  private async openNeighbors(
    message: Extract<WebviewMessage, { type: 'open' }>,
    role: CodeHighlight['role'],
    column: vscode.ViewColumn,
  ): Promise<void> {
    const wanted = new Map<string, CodeHighlight>();
    for (const highlight of message.highlights) {
      if (highlight.role === role && highlight.direct && highlight.file !== message.file && !wanted.has(highlight.file)) {
        wanted.set(highlight.file, highlight);
      }
    }
    for (const highlight of [...wanted.values()].slice(0, MAX_OPENED_NEIGHBORS)) {
      const neighbor = this.resolve(highlight.file);
      if (!neighbor) {
        continue;
      }
      try {
        // Where the name is written (the exact line) is more useful to land on than the top of the symbol.
        const site = message.sites.find((s) => s.file === highlight.file && s.role === role);
        const line = (site?.line ?? highlight.startLine) - 1;
        const editor = await vscode.window.showTextDocument(neighbor, {
          viewColumn: column,
          preserveFocus: true,
          preview: false,
          selection: new vscode.Range(line, 0, line, 0),
        });
        editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
      } catch (error) {
        console.error(`Vibe Review: could not open ${highlight.file}`, error); // not worth interrupting the click for
      }
    }
  }

  /** Paint the marks on every editor that is visible right now (editors without marks are cleared). */
  private applyMarks(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      const file = vscode.workspace.asRelativePath(editor.document.uri, false);
      const lines = (start: number, end: number) => new vscode.Range(start - 1, 0, end - 1, 0);

      const changed = this.marks
        ? (this.changes.find((change) => change.path === file)?.ranges ?? []).map((range) => lines(range.start, range.end))
        : [];
      const mark = (role: CodeHighlight['role']): vscode.DecorationOptions[] =>
        (this.marks?.highlights ?? [])
          .filter((highlight) => highlight.file === file && highlight.role === role)
          .map((highlight) => ({
            range: lines(highlight.startLine, highlight.endLine),
            // A short note after the symbol's first line says why it is marked.
            renderOptions: {
              after: {
                contentText: `  ${role === 'uses' ? 'used by' : 'uses'} ${this.marks?.origin}`,
                color: new vscode.ThemeColor('editorCodeLens.foreground'),
                fontStyle: 'italic',
              },
            },
          }));

      const own = this.marks && this.marks.file === file ? [lines(this.marks.line, this.marks.endLine)] : [];
      const site = (role: CodeSite['role']) =>
        (this.marks?.sites ?? []).filter((s) => s.file === file && s.role === role).map((s) => lines(s.line, s.line));

      editor.setDecorations(changedMark, changed);
      editor.setDecorations(usesMark, mark('uses'));
      editor.setDecorations(usedByMark, mark('usedBy'));
      editor.setDecorations(selfMark, own);
      editor.setDecorations(usesSiteMark, site('uses'));
      editor.setDecorations(usedBySiteMark, site('usedBy'));
    }
  }

  private clearMarks(): void {
    this.marks = undefined;
    this.applyMarks();
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
      const { graph, changes } = await this.graphService.build(folder.uri.fsPath, this.scope, (done, total) => {
        if (loadId === this.loadCounter) {
          this.post({ type: 'loading', message: `Analyzing workspace... ${done}/${total} files` });
        }
      });
      if (loadId === this.loadCounter) {
        this.changes = changes;
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
