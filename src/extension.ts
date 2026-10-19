import * as path from 'node:path';
import * as vscode from 'vscode';
import { GitChangeProvider } from './changes/GitChangeProvider';
import { buildGraph } from './core/GraphBuilder';
import type { GraphScope } from './core/types';
import { createRegistry } from './languages';
import { ParserLoader } from './parser/ParserLoader';
import { NodeResolveContext } from './workspace/NodeResolveContext';
import { WorkspaceAnalyzer } from './workspace/WorkspaceAnalyzer';

export function activate(context: vscode.ExtensionContext): void {
  // The "Vibe Review" tab in the Output panel; we log what the extension finds there.
  const output = vscode.window.createOutputChannel('Vibe Review');
  context.subscriptions.push(output);

  // The .wasm files are copied to dist/grammars by the build (see esbuild.mjs).
  const parser = new ParserLoader((fileName) => path.join(context.extensionPath, 'dist', 'grammars', fileName));

  // Knows which language strategy handles which file; see src/languages/index.ts.
  const registry = createRegistry();

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

    // Temporary step 4c command: runs the real pipeline (registry -> parser -> strategy)
    // on the open file so the result can be compared with the file by eye.
    vscode.commands.registerCommand('vibeReview.analyzeActiveFile', async () => {
      const document = vscode.window.activeTextEditor?.document;
      output.show(true);
      if (!document) {
        output.appendLine('Open a file first.');
        return;
      }

      const strategy = registry.forFile(document.fileName);
      if (!strategy) {
        output.appendLine(`No language strategy for ${path.basename(document.fileName)}`);
        return;
      }

      // Imports are resolved relative to the workspace folder, with forward-slash paths.
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!folder) {
        output.appendLine(
          'The file is not inside an open workspace folder. Open the project folder that contains it (File > Open Folder) and try again.',
        );
        return;
      }
      const relativePath = path.relative(folder.uri.fsPath, document.fileName).split(path.sep).join('/');
      const resolveContext = new NodeResolveContext(folder.uri.fsPath);

      try {
        const started = Date.now();
        const source = document.getText();
        const tree = await parser.parse(strategy.grammarFor(document.fileName), source);
        try {
          const analysis = strategy.extract({ path: relativePath, source, tree });
          output.appendLine(
            `--- ${path.basename(document.fileName)} (${strategy.id}, ${Date.now() - started} ms, ` +
              `syntax errors: ${tree.rootNode.hasError}) ---`,
          );
          output.appendLine(`Symbols (${analysis.symbols.length}):`);
          for (const symbol of analysis.symbols) {
            output.appendLine(`  ${symbol.kind.padEnd(9)} ${symbol.name}  [lines ${symbol.startLine}-${symbol.endLine}]`);
          }
          output.appendLine(`Imports (${analysis.imports.length}):`);
          for (const imported of analysis.imports) {
            const target = strategy.resolveImport(imported.specifier, relativePath, resolveContext);
            output.appendLine(
              `  line ${String(imported.line).padEnd(4)} ${imported.specifier}  ->  ${target ?? '(external or not found)'}`,
            );
          }
        } finally {
          tree.delete(); // free WASM memory, even if extraction threw
        }
      } catch (error) {
        output.appendLine(`Analysis failed: ${error instanceof Error ? error.stack : error}`);
      }
    }),

    // Temporary step 6 command: runs the whole pipeline on the workspace and shows the
    // diagram data (what the webview will receive) as JSON, so it can be checked by eye.
    vscode.commands.registerCommand('vibeReview.buildGraph', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage('Vibe Review: open a folder first.');
        return;
      }
      const scope = (await vscode.window.showQuickPick(['changes', 'full'], {
        placeHolder: 'Which view? "changes" = changed files and their neighbours, "full" = every file',
      })) as GraphScope | undefined;
      if (!scope) {
        return;
      }

      try {
        const graph = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Vibe Review: analyzing workspace' },
          async (progress) => {
            const started = Date.now();
            let lastPercent = 0;
            const { files, skipped, stats } = await analyzer(folder.uri.fsPath).analyze((done, total) => {
              const percent = Math.floor((done / total) * 100);
              progress.report({ increment: percent - lastPercent, message: `${done}/${total} files` });
              lastPercent = percent;
            });
            const changes = await new GitChangeProvider(folder.uri.fsPath).getChanges();

            output.appendLine(
              `Analyzed ${files.length} files in ${Date.now() - started} ms, ${skipped.length} skipped, ${changes.length} changed.`,
            );
            output.appendLine(
              `  list files: ${stats.listMs} ms | parse: ${stats.parseMs} ms (${stats.parsedFiles} parsed, ${stats.cachedFiles} from cache) | resolve imports: ${stats.resolveMs} ms`,
            );
            for (const problem of skipped) {
              output.appendLine(`  skipped ${problem.path}: ${problem.reason}`);
            }
            return buildGraph(files, changes, scope);
          },
        );

        const summary = graph.nodes.reduce<Record<string, number>>((counts, node) => {
          counts[node.status] = (counts[node.status] ?? 0) + 1;
          return counts;
        }, {});
        output.appendLine(
          `Graph (${scope}): ${graph.nodes.length} nodes ${JSON.stringify(summary)}, ${graph.edges.length} edges, review order: ${graph.reviewOrder.length} files`,
        );
        output.show(true);

        const document = await vscode.workspace.openTextDocument({
          language: 'json',
          content: JSON.stringify(graph, null, 2),
        });
        await vscode.window.showTextDocument(document, { preview: false });
      } catch (error) {
        output.appendLine(`Build graph failed: ${error instanceof Error ? error.stack : error}`);
        output.show(true);
      }
    }),
  );

  // One analyzer per workspace folder, so its cache survives between runs of a command.
  const analyzers = new Map<string, WorkspaceAnalyzer>();
  function analyzer(root: string): WorkspaceAnalyzer {
    let existing = analyzers.get(root);
    if (!existing) {
      existing = new WorkspaceAnalyzer(root, registry, parser);
      analyzers.set(root, existing);
    }
    return existing;
  }
}

export function deactivate(): void {}
