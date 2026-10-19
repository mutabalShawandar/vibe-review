import type { FileAnalysis, ParsedFile } from './types';

/**
 * Filesystem access given to strategies instead of letting them use `fs` directly.
 * Why: strategies stay pure, and tests can pass a fake in-memory filesystem.
 */
export interface ResolveContext {
  /** True if the workspace-relative path exists as a file. */
  fileExists(path: string): boolean;
  /** File contents, or undefined if it cannot be read. Used for config files like tsconfig.json. */
  readFile(path: string): string | undefined;
}

/**
 * Everything the core needs to know about one language or framework.
 * This is the Strategy pattern: the core calls these methods and never branches
 * on a language name. Supporting a new stack means implementing this interface in
 * src/languages/<lang>/ and registering it in src/languages/index.ts.
 *
 * How the core uses a strategy for one file:
 *   1. registry.forFile(path)          -> picks the strategy by extension
 *   2. parser parses the file          -> using `grammarFor(path)`
 *   3. strategy.extract(parsedFile)    -> symbols + raw import strings
 *   4. strategy.resolveImport(...)     -> each import string becomes a file (graph edge)
 *   5. strategy.entryPoint?(path)      -> optional label shown on the node
 */
export interface LanguageStrategy {
  /** Unique id, e.g. "typescript", "python". Shown on graph nodes. */
  readonly id: string;

  /** Lowercase extensions including the dot, e.g. [".ts", ".tsx"]. Each may belong to one strategy only. */
  readonly extensions: readonly string[];

  /**
   * File name of the tree-sitter grammar for a file, e.g. "tree-sitter-tsx.wasm".
   * A function (not a constant) because one strategy can need several grammars:
   * TypeScript uses a different grammar for .ts than for .tsx.
   * The file must be listed in GRAMMARS in esbuild.mjs so it ships with the extension.
   */
  grammarFor(path: string): string;

  /**
   * Read a parsed file and report what is in it.
   * Example (TypeScript): `import { a } from "./utils"` + `export class Foo {}`
   *   -> { imports: [{ specifier: "./utils", line: 1 }], symbols: [{ name: "Foo", kind: "class", ... }] }
   */
  extract(file: ParsedFile): FileAnalysis;

  /**
   * Turn an import string into a file inside the workspace.
   * Example: ("./utils", "src/app/page.tsx") -> "src/app/utils.ts"
   * Return undefined for external packages ("react") or anything that does not
   * exist in the workspace; those are not drawn in the graph.
   */
  resolveImport(specifier: string, fromFile: string, ctx: ResolveContext): string | undefined;

  /**
   * Optional. Label for notable files so the reviewer sees entry points at a glance.
   * Example: "src/app/users/page.tsx" -> "Next.js page"; "app/routers/users.py" -> "FastAPI router".
   */
  entryPoint?(path: string): string | undefined;
}
