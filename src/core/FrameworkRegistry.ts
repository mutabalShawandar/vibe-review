import type { FrameworkStrategy } from './FrameworkStrategy';
import type { ResolveContext } from './LanguageStrategy';

/** Gives the label of a workspace file, or undefined for an ordinary one. */
export type EntryPointLabeler = (path: string) => string | undefined;

/**
 * Holds every registered framework strategy. Once per scan, `labeler` asks each one where it is
 * used, then answers "what role does this file play?" without the core knowing any framework.
 */
export class FrameworkRegistry {
  private readonly byId = new Map<string, FrameworkStrategy>();

  register(strategy: FrameworkStrategy): void {
    if (this.byId.has(strategy.id)) {
      throw new Error(`Framework strategy "${strategy.id}" is already registered`);
    }
    this.byId.set(strategy.id, strategy);
  }

  /** All registered strategies, in registration order. */
  all(): FrameworkStrategy[] {
    return [...this.byId.values()];
  }

  /**
   * Run detection for every strategy and return the function that labels files.
   * A file belongs to the deepest project folder that contains it (a Next.js app nested in a
   * monorepo is judged by its own rules); if several frameworks share that folder, the first
   * registered one that has a label for the file wins.
   */
  labeler(ctx: ResolveContext, files: readonly string[]): EntryPointLabeler {
    const projects: { root: string; strategy: FrameworkStrategy }[] = [];
    for (const strategy of this.byId.values()) {
      for (const root of strategy.detect(ctx, files)) {
        projects.push({ root, strategy });
      }
    }
    // Deepest folder first, so the first project whose folder contains a file is the closest one.
    projects.sort((a, b) => b.root.length - a.root.length);

    return (path) => {
      let closest: string | undefined;
      for (const { root, strategy } of projects) {
        if (closest !== undefined && root.length < closest.length) {
          break; // only projects in the closest folder compete
        }
        const inside = relativeTo(root, path);
        if (inside === undefined) {
          continue;
        }
        closest = root;
        const label = strategy.entryPoint(inside);
        if (label) {
          return label;
        }
      }
      return undefined;
    };
  }
}

/** The path relative to a project folder, or undefined when the file is outside it. "" is the workspace root. */
function relativeTo(root: string, path: string): string | undefined {
  if (root === '') {
    return path;
  }
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : undefined;
}
