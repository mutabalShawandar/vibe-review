import type { Tree } from 'web-tree-sitter';
import type { FileRole } from './FrameworkStrategy';

// Shared data shapes. Language-agnostic: nothing here may mention a specific language.
// All file paths are workspace-relative with forward slashes (e.g. "src/app/page.tsx"),
// so the same path works on Windows, macOS and Linux.

// --- What a strategy reads out of ONE file ----------------------------------------

/**
 * The kinds of declarations we show inside a file card.
 *   method, property - members inside a class or interface
 *   component        - a UI component (e.g. a React function that returns JSX)
 *   hook             - a reusable stateful function (e.g. React's useSomething)
 */
export type SymbolKind =
  | 'class'
  | 'interface'
  | 'function'
  | 'type'
  | 'enum'
  | 'variable'
  | 'component'
  | 'hook'
  | 'method'
  | 'property';

/**
 * A declaration in a file, e.g. `export class UserService {...}`.
 * Lines are 1-based and inclusive. The line range is what lets us decide later
 * whether the symbol was touched by a git change.
 */
export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  /** For classes and interfaces: their methods and properties, in source order. */
  members?: SymbolInfo[];
  /**
   * Which names brought in by this file's imports the symbol uses inside its body, by their
   * local names (sorted, no duplicates). Absent when it uses none. Approximate: a local
   * variable that reuses an imported name is counted as a use.
   */
  references?: string[];
  /** Where those names appear: local name -> the 1-based lines inside the symbol that mention it. */
  referenceLines?: Record<string, number[]>;
  /** The file's default export (`export default ...`), which is what `import X from './file'` receives. */
  isDefault?: boolean;
}

/**
 * One name an import brings in. For `import { getUsers as fetchUsers } from './users'`:
 *   { imported: 'getUsers', local: 'fetchUsers' }
 * `imported` is the name in the OTHER file; `local` is the name used in THIS file.
 */
export interface ImportBinding {
  /** Name in the imported file: a symbol name, 'default', or '*' for the whole module. */
  imported: string;
  /** Name used in this file. Empty when no name is created, e.g. `export * from './x'`. */
  local: string;
  /** Imported only as a type (`import type`), so it exists only at compile time. */
  typeOnly: boolean;
  /** A re-export (`export { a } from './x'`): passes the name along instead of using it. */
  reexport: boolean;
}

/**
 * An import exactly as written in source, before it is resolved to a file.
 * e.g. `import { a } from "./utils"` -> { specifier: "./utils", line: 1, bindings: [{ imported: 'a', ... }] }
 */
export interface ImportRef {
  specifier: string;
  line: number;
  /** The names it brings in. Empty for a side-effect import such as `import './styles.css'`. */
  bindings: ImportBinding[];
}

/** An import after resolution: which workspace file it points to and which names it takes from it. */
export interface ResolvedImport {
  file: string;
  /** Every binding from every import statement that points at this file, without duplicates. */
  bindings: ImportBinding[];
}

/** What a strategy extracts from one file: what it declares and what it imports. */
export interface FileAnalysis {
  symbols: SymbolInfo[];
  imports: ImportRef[];
}

/**
 * A file after parsing, handed to a strategy's `extract`. The caller owns `tree`
 * (and frees it with `tree.delete()`); strategies only read it.
 */
export interface ParsedFile {
  path: string;
  source: string;
  tree: Tree;
}

/**
 * One file after the whole pipeline ran on it: parsed, symbols extracted, and its
 * imports resolved to other workspace files. This is the input of GraphBuilder.
 */
export interface AnalyzedFile {
  path: string;
  /** The id of the strategy that analyzed it, e.g. "typescript". */
  language: string;
  symbols: SymbolInfo[];
  /** Workspace files this file imports, with the names taken from each (one entry per file, no external packages). */
  imports: ResolvedImport[];
  /** Set by the strategy for notable files, e.g. "Next.js page". */
  entryPoint?: string;
  /** What the file is for, from the project's framework (page, UI, API...). Absent when nothing recognized it. */
  role?: FileRole;
}

// --- What changed in git -----------------------------------------------------------

/** A stretch of lines. 1-based and inclusive. */
export interface LineRange {
  start: number;
  end: number;
}

export type ChangeKind = 'added' | 'modified' | 'deleted';

/** One changed file and which lines of its NEW version were touched. */
export interface FileChange {
  path: string;
  kind: ChangeKind;
  ranges: LineRange[];
}

/** Everything git reports as changed right now. Produced in step 3. */
export type ChangeSet = FileChange[];

// --- Output of GraphBuilder: the only thing the webview receives -------------------

/**
 * How much of the system the diagram shows:
 *   changes - only changed files plus their direct dependents/dependencies
 *   full    - every analyzed file in the workspace, changed ones highlighted
 * The user switches between them in the view; the builder produces either one.
 */
export type GraphScope = 'changes' | 'full';

/**
 * Why a file is in the graph:
 *   changed    - edited in git
 *   dependent  - imports a changed file (could break because of the change)
 *   dependency - is imported by a changed file (context to understand the change)
 *   unchanged  - unrelated to any change; only appears in the 'full' scope
 */
export type NodeStatus = 'changed' | 'dependent' | 'dependency' | 'unchanged';

/**
 * A symbol as shown on a card.
 *   changed  - a git change overlaps its lines
 *   relevant - worth showing on a small card: every symbol of a changed file, and in connected
 *              files only the symbols that use something from a change or are used by one
 */
export interface GraphSymbol extends Omit<SymbolInfo, 'members' | 'references'> {
  changed: boolean;
  relevant: boolean;
  /** Members of a class or interface, each with its own `changed` flag. */
  members?: GraphSymbol[];
}

/** One file card in the diagram. */
export interface GraphNode {
  /** The workspace-relative file path. Also used as the key edges refer to. */
  id: string;
  /** The id of the strategy that analyzed it, e.g. "typescript". */
  language: string;
  status: NodeStatus;
  symbols: GraphSymbol[];
  /** Set by the strategy for notable files, e.g. "Next.js page", "FastAPI router". */
  entryPoint?: string;
  /** What the file is for (page, UI, API...), shown as a chip on the card. Absent when nothing recognized it. */
  role?: FileRole;
}

/** A symbol in a file, or one of its members: `{ symbol: 'UserService', member: 'find' }`. */
export interface SymbolRef {
  symbol: string;
  member?: string;
}

/**
 * One concrete use behind an arrow: `from` (a symbol in the importing file) uses `to` (a symbol
 * in the imported file). A missing side means "the file as a whole": no symbol uses the import
 * (side-effect or unused import), or the name is not a symbol of the imported file
 * (`import * as db`, dynamic `import()`, or a name the file only re-exports).
 */
export interface SymbolLink {
  from?: SymbolRef;
  to?: SymbolRef;
  /** The lines of the importing file where `from` mentions the imported name: the exact places that depend on `to`. */
  lines?: number[];
  /** The name as written in the importing file (its local name), so the exact word can be marked on those lines. */
  name?: string;
}

/** An arrow in the diagram: the file `from` imports the file `to`. */
export interface GraphEdge {
  from: string;
  to: string;
  /** What exactly is used; always at least one entry. */
  uses: SymbolLink[];
}

/** The complete diagram, as plain JSON that is sent to the webview. */
export interface GraphModel {
  /** Which view this model represents, so the webview can show the active toggle. */
  scope: GraphScope;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /**
   * Changed file ids in the suggested review order: files with no changed
   * dependencies first (foundations), then by how many files depend on them.
   */
  reviewOrder: string[];
}
