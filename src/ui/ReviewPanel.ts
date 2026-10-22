import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { ChangeSet, GraphScope } from '../core/types';
import type { ChangeWatcher } from '../workspace/ChangeWatcher';
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
// A line that writes a name from the route: a light tint and a bar on the left. The word itself is
// marked more strongly (below), and a label after the line says what it means.
const usesSiteMark = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(55, 148, 255, 0.12)',
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: 'rgba(55, 148, 255, 1)',
});
const usedBySiteMark = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: 'rgba(224, 138, 30, 0.12)',
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  borderColor: 'rgba(224, 138, 30, 1)',
});
const usesWordMark = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(55, 148, 255, 0.45)',
  borderRadius: '3px',
  borderWidth: '0 0 2px 0',
  borderStyle: 'solid',
  borderColor: 'rgba(55, 148, 255, 1)',
});
const usedByWordMark = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(224, 138, 30, 0.45)',
  borderRadius: '3px',
  borderWidth: '0 0 2px 0',
  borderStyle: 'solid',
  borderColor: 'rgba(224, 138, 30, 1)',
});

const GO_TO_COMMAND = 'vibeReview.goTo';

/**
 * The "Vibe Review" tab. It only hosts the webview (the React app in /webview) and feeds it
 * graphs; all drawing happens in the webview. There is at most one panel at a time.
 */
export class ReviewPanel {
  private static current: ReviewPanel | undefined;

  /** Open the panel, or bring the existing one to the front. */
  static show(context: vscode.ExtensionContext, graphService: GraphService, watcher: ChangeWatcher): void {
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
    ReviewPanel.current = new ReviewPanel(panel, webviewRoot, graphService, watcher);
  }

  // Incremented for every load, so a slow older result cannot overwrite a newer one.
  private loadCounter = 0;
  private scope: GraphScope = 'changes';
  private readonly disposables: vscode.Disposable[] = [];
  // The git changes of the last graph, and the symbols currently marked in the code.
  private changes: ChangeSet = [];
  // The editor column the clicked file opened in; walking the route reuses it.
  private column: vscode.ViewColumn | undefined;
  private marks:
    | { origin: string; file: string; line: number; endLine: number; highlights: CodeHighlight[]; sites: CodeSite[] }
    | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    webviewRoot: vscode.Uri,
    private readonly graphService: GraphService,
    watcher: ChangeWatcher,
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
      // Files changed on disk (an agent writing, a checkout...): show the new state without being asked.
      watcher.onDidChange(() => this.refresh()),
      panel.onDidChangeViewState(() => {
        if (panel.visible && this.stale) {
          this.refresh();
        }
      }),
      vscode.languages.registerHoverProvider({ scheme: 'file' }, { provideHover: (doc, pos) => this.hoverAt(doc, pos) }),
      // The links in the hover run this: ask the graph to open that symbol, which sends back its route.
      vscode.commands.registerCommand(GO_TO_COMMAND, (target: { file: string; key?: string; line?: number }) =>
        this.post({ type: 'navigate', ...target }),
      ),
      // A marked file can come into view later (a tab switch, a file the user opens): mark it too.
      vscode.window.onDidChangeVisibleTextEditors(() => this.applyMarks()),
      panel.onDidDispose(() => {
        this.clearMarks();
        this.column = undefined;
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
    const cursor = Math.max(0, (message.focusLine ?? message.line) - 1);
    try {
      // The cursor goes to the symbol (or the line that depends on it) instead of selecting it; the
      // symbol is marked with a color (below), so the code stays readable.
      const editor = await vscode.window.showTextDocument(uri, {
        // The first click opens beside the graph; walking the route keeps using that same column.
        viewColumn: this.column ?? vscode.ViewColumn.Beside,
        selection: new vscode.Range(cursor, 0, cursor, 0),
      });
      this.column = editor.viewColumn;
      editor.revealRange(new vscode.Range(first, 0, last, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
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
    this.applyMarks();
  }

  /**
   * The hover over marked code: what the symbol uses and what uses it, each a link that walks the
   * route (opens that symbol and marks its own route), plus what the colors stand for.
   */
  private hoverAt(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const marks = this.marks;
    const file = vscode.workspace.asRelativePath(document.uri, false);
    const line = position.line + 1;
    const onSymbol = marks?.file === file && line >= marks.line && line <= marks.endLine;
    const onSite = marks?.sites.some((site) => site.file === file && site.line === line);
    if (!marks || !(onSymbol || onSite)) {
      return undefined;
    }

    // A link per connected symbol one arrow away; the cursor lands on the line that writes the name when known.
    const links = (role: CodeHighlight['role']) =>
      marks.highlights
        .filter((highlight) => highlight.role === role && highlight.direct)
        .slice(0, 12)
        .map((highlight) => {
          const site = marks.sites.find(
            (candidate) =>
              candidate.file === highlight.file &&
              candidate.role === role &&
              candidate.line >= highlight.startLine &&
              candidate.line <= highlight.endLine,
          );
          const args = encodeURIComponent(
            JSON.stringify([{ file: highlight.file, key: highlight.key, line: site?.line ?? highlight.startLine }]),
          );
          return `[\`${highlight.key}\`](command:${GO_TO_COMMAND}?${args} "${highlight.file}:${highlight.startLine}")`;
        });
    const uses = links('uses');
    const usedBy = links('usedBy');

    const text = new vscode.MarkdownString(undefined, true);
    text.isTrusted = { enabledCommands: [GO_TO_COMMAND] }; // lets the links above run our command, nothing else
    const none = '_nothing in the change_';
    text.appendMarkdown(`**Vibe Review** · \`${marks.origin}\`\n\n`);
    text.appendMarkdown(`**Uses** 🟦 ${uses.length > 0 ? uses.join(' · ') : none}\n\n`);
    text.appendMarkdown(`**Used by** 🟧 ${usedBy.length > 0 ? usedBy.join(' · ') : none}\n\n`);
    text.appendMarkdown(
      '---\n\n🟪 the symbol you opened · 🟦 what it uses · 🟧 what uses it · 🟩 changed lines  \n' +
        'A stronger line is where the name is written; the lighter tint is the whole symbol.',
    );
    return new vscode.Hover(text);
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
                color: role === 'uses' ? '#3794ff' : '#e08a1e', // same colors as the tints
                fontStyle: 'italic',
              },
            },
          }));

      const own = this.marks && this.marks.file === file ? [lines(this.marks.line, this.marks.endLine)] : [];

      // The marked lines of this file for one role, with a label after each, and the exact word on it.
      const sitesOf = (role: CodeSite['role']) => {
        const lineMarks: vscode.DecorationOptions[] = [];
        const words: vscode.Range[] = [];
        const origin = this.marks?.origin ?? '';
        const labeled = new Set<number>();
        for (const site of this.marks?.sites ?? []) {
          if (site.file !== file || site.role !== role || site.line > editor.document.lineCount) {
            continue;
          }
          const text = editor.document.lineAt(site.line - 1).text;
          if (site.name) {
            // The word, not as a property (`a.getUsers`) and not as part of a longer name.
            const escaped = site.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const word = new RegExp('(?<![\\w$.])' + escaped + '(?![\\w$])', 'g');
            for (const match of text.matchAll(word)) {
              words.push(new vscode.Range(site.line - 1, match.index, site.line - 1, match.index + site.name.length));
            }
          }
          if (labeled.has(site.line)) {
            continue; // two names on one line: one label is enough
          }
          labeled.add(site.line);
          lineMarks.push({
            range: lines(site.line, site.line),
            renderOptions: {
              after: {
                // Blue: this code relies on `name`. Orange: this code relies on the symbol you opened.
                contentText: role === 'uses' ? `  → uses ${site.name || 'an import'}` : `  ← uses ${origin}`,
                color: role === 'uses' ? '#3794ff' : '#e08a1e',
                fontStyle: 'italic',
              },
            },
          });
        }
        return { lineMarks, words };
      };
      const usesSites = sitesOf('uses');
      const usedBySites = sitesOf('usedBy');

      editor.setDecorations(changedMark, changed);
      editor.setDecorations(usesMark, mark('uses'));
      editor.setDecorations(usedByMark, mark('usedBy'));
      editor.setDecorations(selfMark, own);
      editor.setDecorations(usesSiteMark, usesSites.lineMarks);
      editor.setDecorations(usedBySiteMark, usedBySites.lineMarks);
      editor.setDecorations(usesWordMark, usesSites.words);
      editor.setDecorations(usedByWordMark, usedBySites.words);
    }
  }

  private clearMarks(): void {
    this.marks = undefined;
    this.applyMarks();
  }

  // True when files changed while the tab was in the background; it refreshes when shown again.
  private stale = false;

  /** Rebuild the graph after a file change. Silent: the current graph stays on screen until the new one arrives. */
  private refresh(): void {
    if (!this.panel.visible) {
      this.stale = true;
      return;
    }
    void this.load(true);
  }

  private async load(silent = false): Promise<void> {
    this.stale = false;
    const loadId = ++this.loadCounter;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.post({ type: 'error', message: 'Open a folder first (File > Open Folder).' });
      return;
    }

    if (!silent) {
      this.post({ type: 'loading', message: 'Analyzing workspace...' });
    }
    try {
      const { graph, changes } = await this.graphService.build(folder.uri.fsPath, this.scope, (done, total) => {
        if (loadId === this.loadCounter && !silent) {
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
