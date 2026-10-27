import type { ResolveContext } from './LanguageStrategy';

/**
 * Everything the core needs to know about one framework (Next.js, FastAPI, Express...).
 * A framework is not a language: Next.js and Express are both TypeScript, and one project
 * can use several frameworks (a monorepo with a web app and an API). So frameworks are a
 * second Strategy next to LanguageStrategy. Supporting a new one means implementing this
 * interface in src/frameworks/<name>/ and registering it in src/frameworks/index.ts.
 *
 * How the core uses a framework once per scan:
 *   1. strategy.detect(ctx, files)     -> the project folders that use the framework
 *   2. strategy.entryPoint(path)       -> the role label of a file, relative to its project folder
 *   3. strategy.route?.(path)          -> optional: the URL the file belongs to, for frameworks that route by file
 */
export interface FrameworkStrategy {
  /** Unique id, e.g. "nextjs", "fastapi". */
  readonly id: string;

  /**
   * Find the projects in the workspace that use this framework.
   * Returns workspace-relative folders with forward slashes, "" for the workspace root.
   * Example (Next.js): files has "web/package.json" listing "next" -> ["web"].
   * Return [] when the framework is not used.
   * @param files every file git knows in the workspace, so detection needs no directory walk.
   */
  detect(ctx: ResolveContext, files: readonly string[]): string[];

  /**
   * Label for a notable file, or undefined for an ordinary one.
   * `path` is relative to the project folder `detect` returned, so the same rules work
   * wherever the project lives. Example: "src/app/users/page.tsx" -> "Next.js page".
   */
  entryPoint(path: string): string | undefined;

  /**
   * Optional, for frameworks that turn files into URLs. The route a labeled file belongs to, as a
   * URL path with the dynamic parts as the framework writes them: "/users/[id]". Files that
   * share a route (a page and its layout) return the same string. `path` is relative to the project folder.
   */
  route?(path: string): string | undefined;
}
