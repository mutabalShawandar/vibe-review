import type { ResolveContext } from './LanguageStrategy';

/**
 * What a file is for, in terms every framework shares. The diagram groups and colors files by
 * role, so a Next.js project and a Vite project end up with the same bands even though their
 * folders differ.
 *   page   - a screen or route: what the user navigates to
 *   ui     - a reusable piece of interface (components)
 *   api    - server endpoints, route handlers, middleware
 *   hook   - reusable stateful logic for the UI
 *   lib    - logic and data that has no UI: utilities, services, stores, database access
 *   types  - type declarations only
 *   test   - tests
 *   other  - nothing above matched
 */
export type FileRole = 'page' | 'ui' | 'api' | 'hook' | 'lib' | 'types' | 'test' | 'other';

/**
 * Everything the core needs to know about one framework (Next.js, Remix, FastAPI...).
 * A framework is a different question from a language: `.tsx` is TypeScript whether the project
 * uses Next.js or Vite, so the LanguageStrategy (parsing, symbols, imports) is picked by file
 * extension, while a FrameworkStrategy is picked once per project by looking at what it depends on.
 * Frameworks only describe where files live and what they are; they never parse code.
 *
 * To support a new framework: implement this interface in src/frameworks/<name>/ and register it in
 * src/frameworks/index.ts, before the generic fallback.
 */
export interface FrameworkStrategy {
  /** Unique id, e.g. "nextjs". */
  readonly id: string;

  /** Human name, e.g. "Next.js". */
  readonly name: string;

  /**
   * Does the workspace use this framework? Read config files and dependencies through `ctx`
   * (paths are workspace-relative), never with `fs`. Must be cheap: it runs on every refresh.
   * Example: package.json lists "next", or next.config.js exists.
   */
  detect(ctx: ResolveContext): boolean;

  /**
   * The role of a file, judged from its workspace-relative path alone, or undefined when this
   * framework has no opinion (the registry then tries the generic conventions).
   * Example: "src/app/users/page.tsx" -> "page"; "src/components/Button.tsx" -> undefined.
   */
  roleOf(path: string): FileRole | undefined;

  /**
   * Optional. Label for files the framework treats specially, shown on the card.
   * Example: "src/app/users/page.tsx" -> "Next.js page".
   */
  entryPoint?(path: string): string | undefined;
}
