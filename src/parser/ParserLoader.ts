import { Language, Parser, type Tree } from 'web-tree-sitter';

/**
 * Parses source code with tree-sitter, which runs as WebAssembly (WASM).
 * Two kinds of .wasm files are involved:
 *   - the tree-sitter runtime itself ("tree-sitter.wasm"), loaded once
 *   - one grammar per language ("tree-sitter-python.wasm", ...), loaded on first use
 * Where those files live differs between production (copied into dist/grammars at
 * build time) and tests (inside node_modules), so the caller supplies `resolveWasm`.
 */
export class ParserLoader {
  // Starting the runtime is slow and must happen only once; every caller awaits the same promise.
  private runtimeReady: Promise<void> | undefined;

  // Loaded grammars by file name, so each grammar is read from disk only once.
  private readonly grammars = new Map<string, Promise<Language>>();

  /** @param resolveWasm maps a .wasm file name (e.g. "tree-sitter-python.wasm") to its full path. */
  constructor(private readonly resolveWasm: (fileName: string) => string) {}

  /** Parse `source` using the grammar in `grammarFile`. */
  async parse(grammarFile: string, source: string): Promise<Tree> {
    const language = await this.loadGrammar(grammarFile);

    // A Parser is cheap and holds state for one parse, so make a fresh one each time.
    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(source);
    parser.delete(); // WASM memory is not garbage collected; free it explicitly

    if (!tree) {
      throw new Error(`tree-sitter could not parse the source with ${grammarFile}`);
    }
    return tree;
  }

  private loadGrammar(grammarFile: string): Promise<Language> {
    let loading = this.grammars.get(grammarFile);
    if (!loading) {
      loading = this.initRuntime().then(() => Language.load(this.resolveWasm(grammarFile)));
      this.grammars.set(grammarFile, loading);
    }
    return loading;
  }

  private initRuntime(): Promise<void> {
    // `locateFile` tells the runtime where to find its own .wasm; without it the runtime
    // looks next to the bundled script, which breaks once everything is bundled.
    this.runtimeReady ??= Parser.init({ locateFile: (name: string) => this.resolveWasm(name) });
    return this.runtimeReady;
  }
}
