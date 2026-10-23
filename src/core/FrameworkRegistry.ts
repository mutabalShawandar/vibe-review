import type { FileRole, FrameworkStrategy } from './FrameworkStrategy';
import type { ResolveContext } from './LanguageStrategy';

/**
 * Holds the registered framework strategies and picks the one that fits a workspace.
 * Registration order is specificity order: put "Next.js" before "plain React", and the generic
 * fallback (which detects everything) last. The first strategy whose `detect` says yes wins.
 *
 * Usage (done once in src/frameworks/index.ts):
 *   const registry = new FrameworkRegistry();
 *   registry.register(new NextJsStrategy());
 *   registry.register(new GenericStrategy()); // last: always matches
 */
export class FrameworkRegistry {
  private readonly strategies: FrameworkStrategy[] = [];

  register(strategy: FrameworkStrategy): void {
    if (this.strategies.some((existing) => existing.id === strategy.id)) {
      throw new Error(`Framework strategy "${strategy.id}" is already registered`);
    }
    this.strategies.push(strategy);
  }

  /** The strategy for this workspace: the first registered one that detects its framework. */
  detect(ctx: ResolveContext): FrameworkStrategy | undefined {
    return this.strategies.find((strategy) => strategy.detect(ctx));
  }

  /** A strategy by id, or undefined if none is registered. */
  forId(id: string): FrameworkStrategy | undefined {
    return this.strategies.find((strategy) => strategy.id === id);
  }

  /**
   * The role of a file under the given framework. Anything the framework has no opinion about is
   * left to the strategies registered after it (so the generic conventions still apply in a Next.js
   * project), and a file nobody recognizes is "other".
   */
  roleOf(framework: FrameworkStrategy, path: string): FileRole {
    const start = this.strategies.indexOf(framework);
    for (const strategy of start === -1 ? [framework] : this.strategies.slice(start)) {
      const role = strategy.roleOf(path);
      if (role) {
        return role;
      }
    }
    return 'other';
  }

  /** All registered strategies, in registration order. */
  all(): FrameworkStrategy[] {
    return [...this.strategies];
  }
}
