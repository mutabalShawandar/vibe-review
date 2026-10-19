import { Query, type Language, type Node } from 'web-tree-sitter';
import type { LanguageStrategy, ResolveContext } from '../../core/LanguageStrategy';
import type { FileAnalysis, ImportRef, ParsedFile, SymbolInfo, SymbolKind } from '../../core/types';
import { bindingsFor } from './bindings';
import importsQuery from './queries/imports.scm';
import symbolsQuery from './queries/symbols.scm';
import { resolveTypeScriptImport } from './resolveImport';

// The capture names in symbols.scm that mark a whole declaration, one per symbol kind.
const SYMBOL_KINDS: readonly SymbolKind[] = ['class', 'interface', 'function', 'type', 'enum', 'variable'];

// Syntax-tree node types inside a class body or interface body that we list as members.
const MEMBER_KINDS: Record<string, SymbolKind> = {
  method_definition: 'method', // doSomething() {} and constructor() {}
  abstract_method_signature: 'method', // abstract run(): void
  method_signature: 'method', // interface: find(id: string): User
  public_field_definition: 'property', // class field: items = []
  property_signature: 'property', // interface: name: string
};

// JSX in a function or variable is what makes it a UI component.
const JSX_NODES = ['jsx_element', 'jsx_self_closing_element', 'jsx_fragment'];

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

  resolveImport(specifier: string, fromFile: string, ctx: ResolveContext): string | undefined {
    return resolveTypeScriptImport(specifier, fromFile, ctx, this.extensions);
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
      const kind = refineKind(declaration.name as SymbolKind, name, node);
      const members = kind === 'class' || kind === 'interface' ? membersOf(node) : [];
      const symbol: SymbolInfo = {
        name,
        kind,
        startLine: node.startPosition.row + 1,
        endLine: lastLineOf(node),
        ...(members.length > 0 ? { members } : {}),
      };

      // `const Page = () => {}` matches both the "function" and the generic "variable"
      // pattern. Keep the more specific one (anything but a plain variable).
      const key = `${name}@${symbol.startLine}`;
      if (found.get(key) === undefined || found.get(key)!.kind === 'variable') {
        found.set(key, symbol);
      }
    }

    return [...found.values()].sort((a, b) => a.startLine - b.startLine);
  }

  private extractImports(query: Query, root: Node): ImportRef[] {
    const imports: ImportRef[] = [];
    for (const capture of query.captures(root)) {
      if (capture.name === 'source') {
        imports.push({
          specifier: capture.node.text,
          line: capture.node.startPosition.row + 1,
          bindings: bindingsFor(capture.node),
        });
      }
    }
    return imports.sort((a, b) => a.line - b.line);
  }
}

/**
 * Decide whether a function or variable is really a React-style hook or component.
 * These are naming conventions React itself relies on:
 *   useSomething           -> hook
 *   PascalCase + has JSX   -> component (also covers `const Button = forwardRef(...)`)
 * Everything else keeps the kind the query found.
 */
function refineKind(kind: SymbolKind, name: string, node: Node): SymbolKind {
  if (kind !== 'function' && kind !== 'variable') {
    return kind;
  }
  if (/^use[A-Z0-9]/.test(name)) {
    return 'hook';
  }
  if (/^[A-Z]/.test(name) && node.descendantsOfType(JSX_NODES).length > 0) {
    return 'component';
  }
  return kind;
}

/** Methods and properties declared directly inside a class or interface. */
function membersOf(node: Node): SymbolInfo[] {
  // For `export class X {}` the query captured the export statement; the class is inside it.
  const declaration = node.type === 'export_statement' ? node.childForFieldName('declaration') : node;
  const body = declaration?.childForFieldName('body');
  if (!body) {
    return [];
  }

  const members = new Map<string, SymbolInfo>();
  for (const child of body.namedChildren) {
    const kind = child ? MEMBER_KINDS[child.type] : undefined;
    const name = child?.childForFieldName('name')?.text;
    if (!child || !kind || !name) {
      continue; // index signatures, call signatures, comments...
    }
    // A getter and setter, or overloads, share a name; list the member once.
    const key = `${kind}:${name}`;
    if (!members.has(key)) {
      members.set(key, { name, kind, startLine: child.startPosition.row + 1, endLine: lastLineOf(child) });
    }
  }
  return [...members.values()];
}

/** 1-based last line of a node. A node ending at column 0 really ends on the line before. */
function lastLineOf(node: Node): number {
  const { row, column } = node.endPosition;
  return column === 0 && row > node.startPosition.row ? row : row + 1;
}
