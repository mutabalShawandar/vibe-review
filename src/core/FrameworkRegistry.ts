import type { FrameworkStrategy } from './FrameworkStrategy';
import type { ResolveContext } from './LanguageStrategy';

/** What the frameworks know about one workspace file. */
export interface FileClassification {
  /** The role label, e.g. "Next.js page". */
  entryPoint?: string;
  /** The URL the file belongs to, when its framework routes by file. */
  route?: string;
  /** The project folder the framework was detected in ("" for the workspace root), so equal routes of two projects stay apart. */
  project: string;
}

/** Classifies a workspace file, or returns undefined for an ordinary one. */
export type FileClassifier = (path: string) => FileClassification | undefined;

/**
 * Holds every registered framework strategy. Once per scan, `classifier` asks each one where it is
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
  classifier(ctx: ResolveContext, files: readonly string[]): FileClassifier {
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
        const entryPoint = strategy.entryPoint(inside);
        if (entryPoint) {
          const route = strategy.route?.(inside);
          return { entryPoint, ...(route !== undefined ? { route } : {}), project: root };
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
