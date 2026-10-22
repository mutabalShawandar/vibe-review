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
    const imports = this.extractImports(queries.imports, root);

    // The names this file gets from its imports: the only identifiers worth tracking inside symbols.
    const importedNames = new Set(imports.flatMap((i) => i.bindings.map((b) => b.local)).filter((name) => name !== ''));
    return { symbols: this.extractSymbols(queries.symbols, root, importedNames), imports };
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

  private extractSymbols(query: Query, root: Node, importedNames: Set<string>): SymbolInfo[] {
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
      const members = kind === 'class' || kind === 'interface' ? membersOf(node, importedNames) : [];
      const references = referencesIn(node, importedNames);
      const symbol: SymbolInfo = {
        name,
        kind,
        startLine: node.startPosition.row + 1,
        endLine: lastLineOf(node),
        ...(members.length > 0 ? { members } : {}),
        ...(references ? { references } : {}),
        // `export default function Page() {}` or `export default class Store {}`
        ...(isDefaultExport(node) ? { isDefault: true } : {}),
      };

      // `const Page = () => {}` matches both the "function" and the generic "variable"
      // pattern. Keep the more specific one (anything but a plain variable).
      const key = `${name}@${symbol.startLine}`;
      if (found.get(key) === undefined || found.get(key)!.kind === 'variable') {
        found.set(key, symbol);
      }
    }

    // `export default Page;` makes an already declared symbol the default export.
    for (const statement of root.namedChildren) {
      const value = statement && isDefaultExport(statement) ? statement.childForFieldName('value') : null;
      if (value?.type === 'identifier') {
        for (const symbol of found.values()) {
          if (symbol.name === value.text) {
            symbol.isDefault = true;
          }
        }
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

// Syntax-tree node types that hold a name written in code: variables and functions, types,
// and the name in `{ user }` shorthand. Property names after a dot (`a.b`) are a different
// node type, so `db.query` counts as a use of `db` but not of anything called `query`.
const NAME_NODES = ['identifier', 'type_identifier', 'shorthand_property_identifier'];

/**
 * The imported names (by local name) that appear inside a node, sorted. Undefined if none.
 * JSX tag names such as `<Button />` are plain identifiers, so components are found too.
 */
function referencesIn(node: Node, importedNames: Set<string>): string[] | undefined {
  if (importedNames.size === 0) {
    return undefined;
  }
  const used = new Set<string>();
  for (const name of node.descendantsOfType(NAME_NODES)) {
    if (name && importedNames.has(name.text)) {
      used.add(name.text);
    }
  }
  return used.size > 0 ? [...used].sort() : undefined;
}

/** True for `export default ...` statements, whatever follows `default`. */
function isDefaultExport(node: Node): boolean {
  return node.type === 'export_statement' && node.children.some((child) => child?.type === 'default');
}

/** Methods and properties declared directly inside a class or interface. */
function membersOf(node: Node, importedNames: Set<string>): SymbolInfo[] {
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
      const references = referencesIn(child, importedNames);
      members.set(key, {
        name,
        kind,
        startLine: child.startPosition.row + 1,
        endLine: lastLineOf(child),
        ...(references ? { references } : {}),
      });
    }
  }
  return [...members.values()];
}

/** 1-based last line of a node. A node ending at column 0 really ends on the line before. */
function lastLineOf(node: Node): number {
  const { row, column } = node.endPosition;
  return column === 0 && row > node.startPosition.row ? row : row + 1;
}
