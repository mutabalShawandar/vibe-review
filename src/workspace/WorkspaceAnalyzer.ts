import { promises as fs, readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { FrameworkRegistry } from '../core/FrameworkRegistry';
import type { ResolveContext } from '../core/LanguageStrategy';
import type { StrategyRegistry } from '../core/StrategyRegistry';
import type { AnalyzedFile, ImportBinding, ImportRef, ResolvedImport, SymbolInfo } from '../core/types';
import type { ParserLoader } from '../parser/ParserLoader';
import { listWorkspaceFiles } from './listWorkspaceFiles';

// Larger files are almost always generated or minified bundles, and parsing them is slow.
const MAX_FILE_BYTES = 1024 * 1024;

// Parsing runs on the extension host thread. Pausing briefly every few files lets
// VS Code stay responsive during a big first scan.
const FILES_PER_PAUSE = 25;

function sameBinding(a: ImportBinding, b: ImportBinding): boolean {
  return a.imported === b.imported && a.local === b.local && a.typeOnly === b.typeOnly && a.reexport === b.reexport;
}

export interface AnalysisResult {
  files: AnalyzedFile[];
  /** Files that could not be analyzed, with the reason. */
  skipped: { path: string; reason: string }[];
  /** Files parsed again this time because they were new or edited, newest edit first. */
  reparsed: string[];
  /** Where the time went, to explain a slow scan. */
  stats: { listMs: number; parseMs: number; resolveMs: number; parsedFiles: number; cachedFiles: number };
}

/** What we remember about a file between scans, so unchanged files are not parsed again. */
interface CachedFile {
  mtimeMs: number;
  size: number;
  language: string;
  symbols: SymbolInfo[];
  /** Imports as written. Not resolved here: resolution depends on which OTHER files exist. */
  imports: ImportRef[];
  entryPoint?: string;
}

/**
 * Scans the workspace and runs the full per-file pipeline:
 *   registry -> parser -> strategy.extract -> strategy.resolveImport
 * The result is the input of buildGraph. Parsing results are cached by file
 * modification time, so the second scan only re-parses what changed.
 */
export class WorkspaceAnalyzer {
  private readonly cache = new Map<string, CachedFile>();

  /** @param root the workspace folder; all paths are relative to it. */
  constructor(
    private readonly root: string,
    private readonly registry: StrategyRegistry,
    private readonly parser: ParserLoader,
    private readonly frameworks: FrameworkRegistry,
  ) {}

  async analyze(onProgress?: (done: number, total: number) => void): Promise<AnalysisResult> {
    const listStart = Date.now();
    const listed = await listWorkspaceFiles(this.root);
    const listMs = Date.now() - listStart;
    const codeFiles = listed.filter((file) => this.registry.forFile(file) !== undefined);

    const skipped: AnalysisResult['skipped'] = [];
    const parsed = new Map<string, CachedFile>();
    let cachedFiles = 0;
    const reparsed: { file: string; mtimeMs: number }[] = [];
    const parseStart = Date.now();

    for (const [index, file] of codeFiles.entries()) {
      try {
        const result = await this.analyzeFile(file);
        if (result) {
          parsed.set(file, result.cached);
          if (result.fromCache) {
            cachedFiles++;
          } else {
            reparsed.push({ file, mtimeMs: result.cached.mtimeMs });
          }
        }
      } catch (error) {
        skipped.push({ path: file, reason: error instanceof Error ? error.message : String(error) });
      }

      onProgress?.(index + 1, codeFiles.length);
      if ((index + 1) % FILES_PER_PAUSE === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    const parseMs = Date.now() - parseStart;

    // Forget files that were deleted or became ignored.
    for (const cached of [...this.cache.keys()]) {
      if (!parsed.has(cached)) {
        this.cache.delete(cached);
      }
    }

    // Resolution runs on every scan (it is cheap) because it depends on the whole file set.
    const resolveStart = Date.now();
    const context = this.resolveContext(new Set(listed));
    // Frameworks are detected per scan, like resolution: they depend on package.json and the file set.
    const classify = this.frameworks.classifier(context, listed);
    const files = [...parsed].map(([file, info]): AnalyzedFile => {
      const strategy = this.registry.forId(info.language)!;
      // One entry per target file: a file imported by two statements gets both their names.
      const byTarget = new Map<string, ResolvedImport>();
      for (const imported of info.imports) {
        const target = strategy.resolveImport(imported.specifier, file, context);
        if (!target) {
          continue; // an npm package, or something outside the workspace
        }
        const entry = byTarget.get(target) ?? { file: target, bindings: [] };
        for (const binding of imported.bindings) {
          if (!entry.bindings.some((known) => sameBinding(known, binding))) {
            entry.bindings.push(binding);
          }
        }
        byTarget.set(target, entry);
      }
      const imports = [...byTarget.values()].sort((a, b) => a.file.localeCompare(b.file));
      // The framework knows more than the language ("Next.js page" vs. nothing), so it goes first.
      const framework = classify(file);
      const entryPoint = framework?.entryPoint ?? info.entryPoint;
      return {
        path: file,
        language: info.language,
        symbols: info.symbols,
        imports,
        ...(entryPoint ? { entryPoint } : {}),
        ...(framework?.role ? { role: framework.role } : {}),
        ...(framework?.route !== undefined ? { route: framework.route } : {}),
        ...(framework ? { project: framework.project } : {}),
      };
    });

    const stats = {
      listMs,
      parseMs,
      resolveMs: Date.now() - resolveStart,
      parsedFiles: parsed.size - cachedFiles,
      cachedFiles,
    };
    reparsed.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return { files, skipped, reparsed: reparsed.map((entry) => entry.file), stats };
  }

  /** Analyze one file, reusing the cached result if the file has not changed. */
  private async analyzeFile(file: string): Promise<{ cached: CachedFile; fromCache: boolean } | undefined> {
    const fullPath = path.join(this.root, file);

    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      return undefined; // listed by git but gone from disk (deleted, not yet committed)
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
      return undefined;
    }

    const cached = this.cache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return { cached, fromCache: true };
    }

    const strategy = this.registry.forFile(file)!;
    const source = await fs.readFile(fullPath, 'utf8');
    const tree = await this.parser.parse(strategy.grammarFor(file), source);
    try {
      const analysis = strategy.extract({ path: file, source, tree });
      const result: CachedFile = {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        language: strategy.id,
        symbols: analysis.symbols,
        imports: analysis.imports,
        entryPoint: strategy.entryPoint?.(file),
      };
      this.cache.set(file, result);
      return { cached: result, fromCache: false };
    } finally {
      tree.delete(); // free WASM memory, even if extraction threw
    }
  }

  /**
   * File lookups answered from the git file list instead of the disk: much faster for
   * thousands of imports, and it means ignored folders (node_modules, build output)
   * can never be resolved into.
   */
  private resolveContext(known: Set<string>): ResolveContext {
    return {
      fileExists: (file) => known.has(file),
      readFile: (file) => {
        try {
          return readFileSync(path.join(this.root, file), 'utf8');
        } catch {
          return undefined;
        }
      },
    };
  }
}
