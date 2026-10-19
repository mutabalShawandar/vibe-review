import type { Tree } from 'web-tree-sitter';

// Shared data shapes. Language-agnostic: nothing here may mention a specific language.
// All file paths are workspace-relative with forward slashes (e.g. "src/app/page.tsx"),
// so the same path works on Windows, macOS and Linux.

// --- What a strategy reads out of ONE file ----------------------------------------

/** The kinds of top-level declarations we show inside a file card. */
export type SymbolKind = 'class' | 'interface' | 'function' | 'type' | 'enum' | 'variable';

/**
 * A top-level declaration in a file, e.g. `export class UserService {...}`.
 * Lines are 1-based and inclusive. The line range is what lets us decide later
 * whether the symbol was touched by a git change.
 */
export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
}

/**
 * An import exactly as written in source, before it is resolved to a file.
 * e.g. `import x from "./utils"` -> { specifier: "./utils", line: 1 }
 */
export interface ImportRef {
  specifier: string;
  line: number;
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
  /** Workspace files this file imports (already resolved, no duplicates, no external packages). */
  imports: string[];
  /** Set by the strategy for notable files, e.g. "Next.js page". */
  entryPoint?: string;
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

/** A symbol as shown on a card; `changed` is true if a git change overlaps its lines. */
export interface GraphSymbol extends SymbolInfo {
  changed: boolean;
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
}

/** An arrow in the diagram: the file `from` imports the file `to`. */
export interface GraphEdge {
  from: string;
  to: string;
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
