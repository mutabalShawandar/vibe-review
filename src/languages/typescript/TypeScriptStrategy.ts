import { Query, type Language, type Node } from 'web-tree-sitter';
import type { LanguageStrategy, ResolveContext } from '../../core/LanguageStrategy';
import type { FileAnalysis, ImportRef, ParsedFile, SymbolInfo, SymbolKind } from '../../core/types';
import importsQuery from './queries/imports.scm';
import symbolsQuery from './queries/symbols.scm';

// The capture names in symbols.scm that mark a whole declaration, one per symbol kind.
const SYMBOL_KINDS: readonly SymbolKind[] = ['class', 'interface', 'function', 'type', 'enum', 'variable'];

/** TypeScript and JavaScript (including JSX/TSX), which is what Next.js projects are made of. */
export class TypeScriptStrategy implements LanguageStrategy {
  readonly id = 'typescript';
  readonly extensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;

  // Compiling a query is slow and a Query is tied to one grammar, so each is built once per grammar.
  private readonly queries = new Map<Language, { symbols: Query; imports: Query }>();

  grammarFor(path: string): string {
    // Plain .ts allows `<T>value` casts, which the tsx grammar would read as a JSX tag.
    // Everything else (including .js, which may contain JSX) is safe with the tsx grammar.
    return /\.(ts|mts|cts)$/i.test(path) ? 'tree-sitter-typescript.wasm' : 'tree-sitter-tsx.wasm';
  }

  extract(file: ParsedFile): FileAnalysis {
    const queries = this.queriesFor(file.tree.language);
    const root = file.tree.rootNode;
    return {
      symbols: this.extractSymbols(queries.symbols, root),
      imports: this.extractImports(queries.imports, root),
    };
  }

  // Implemented in step 5 (relative paths, tsconfig aliases, index files).
  resolveImport(_specifier: string, _fromFile: string, _ctx: ResolveContext): string | undefined {
    return undefined;
  }

  private queriesFor(language: Language): { symbols: Query; imports: Query } {
    let queries = this.queries.get(language);
    if (!queries) {
      queries = { symbols: new Query(language, symbolsQuery), imports: new Query(language, importsQuery) };
      this.queries.set(language, queries);
    }
    return queries;
  }

  private extractSymbols(query: Query, root: Node): SymbolInfo[] {
    // Keyed by "name@startLine" so the same declaration found twice collapses to one entry.
    const found = new Map<string, SymbolInfo>();

    for (const match of query.matches(root)) {
      const name = match.captures.find((capture) => capture.name === 'name')?.node.text;
      const declaration = match.captures.find((capture) => (SYMBOL_KINDS as readonly string[]).includes(capture.name));
      if (!name || !declaration) {
        continue;
      }

      const node = declaration.node;
      const symbol: SymbolInfo = {
        name,
        kind: declaration.name as SymbolKind,
        startLine: node.startPosition.row + 1,
        endLine: lastLineOf(node),
      };

      // `const Page = () => {}` matches both the "function" and the generic "variable"
      // pattern. Keep the more specific "function".
      const key = `${name}@${symbol.startLine}`;
      if (found.get(key)?.kind !== 'function') {
        found.set(key, symbol);
      }
    }

    return [...found.values()].sort((a, b) => a.startLine - b.startLine);
  }

  private extractImports(query: Query, root: Node): ImportRef[] {
    const imports: ImportRef[] = [];
    for (const capture of query.captures(root)) {
      if (capture.name === 'source') {
        imports.push({ specifier: capture.node.text, line: capture.node.startPosition.row + 1 });
      }
    }
    return imports.sort((a, b) => a.line - b.line);
  }
}

/** 1-based last line of a node. A node ending at column 0 really ends on the line before. */
function lastLineOf(node: Node): number {
  const { row, column } = node.endPosition;
  return column === 0 && row > node.startPosition.row ? row : row + 1;
}
