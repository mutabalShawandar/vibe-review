import type { LanguageStrategy } from './LanguageStrategy';

/**
 * Holds every registered language strategy and answers one question for the core:
 * "which strategy handles this file?". The core only ever talks to the registry,
 * so it never needs to know which languages exist.
 *
 * Usage (done once in src/languages/index.ts):
 *   const registry = new StrategyRegistry();
 *   registry.register(new TypeScriptStrategy());
 *   registry.register(new PythonStrategy());
 */
export class StrategyRegistry {
  // Lookup by strategy id, e.g. "python" -> PythonStrategy.
  private readonly byId = new Map<string, LanguageStrategy>();

  // Lookup by file extension, e.g. ".tsx" -> TypeScriptStrategy.
  // This is the map used when scanning files in the workspace.
  private readonly byExtension = new Map<string, LanguageStrategy>();

  register(strategy: LanguageStrategy): void {
    // Two strategies with the same id would silently overwrite each other, so fail loudly.
    if (this.byId.has(strategy.id)) {
      throw new Error(`Language strategy "${strategy.id}" is already registered`);
    }

    // Check ALL extensions before changing any state, so a failed registration
    // never leaves the registry half-filled.
    for (const ext of strategy.extensions) {
      const owner = this.byExtension.get(ext);
      if (owner) {
        throw new Error(`Extension "${ext}" is already handled by "${owner.id}"`);
      }
    }

    this.byId.set(strategy.id, strategy);
    for (const ext of strategy.extensions) {
      this.byExtension.set(ext, strategy);
    }
  }

  /** Find the strategy for a file path, or undefined if the file type is unsupported. */
  forFile(path: string): LanguageStrategy | undefined {
    // Take everything from the last dot: "src/app/page.tsx" -> ".tsx".
    const dot = path.lastIndexOf('.');
    if (dot === -1) {
      return undefined; // no extension, e.g. "Makefile"
    }
    // Lowercase so "Foo.PY" and "foo.py" behave the same.
    return this.byExtension.get(path.slice(dot).toLowerCase());
  }

  /** Find a strategy by its id, or undefined if none is registered. */
  forId(id: string): LanguageStrategy | undefined {
    return this.byId.get(id);
  }

  /** All registered strategies, in registration order. */
  all(): LanguageStrategy[] {
    return [...this.byId.values()];
  }
}
