import { posix } from 'node:path';
import type { ResolveContext } from '../../core/LanguageStrategy';
import { dirOf, join, loadImportConfig, type ImportConfig } from './tsconfig';

// Extensions tried, in order, when an import has none: `./utils` -> utils.ts, utils.tsx, ...
const TRY_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

// TypeScript lets you write the compiled name: `import "./a.js"` really means a.ts or a.tsx.
const SOURCE_FOR_COMPILED: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

/**
 * Turn an import string into a workspace file, or undefined when it points outside
 * the workspace (npm packages, Node built-ins) or at something that is not code.
 *
 * @param codeExtensions the extensions this strategy analyzes; other files (css, json, images) are ignored
 */
export function resolveTypeScriptImport(
  specifier: string,
  fromFile: string,
  ctx: ResolveContext,
  codeExtensions: readonly string[],
): string | undefined {
  // 1. Relative import: "./x" and "../x" are measured from the importing file's folder.
  if (isRelative(specifier)) {
    return resolveFile(join(dirOf(fromFile), specifier), ctx, codeExtensions);
  }

  // 2. Everything else is either an alias from tsconfig ("@/lib/db"), a path from baseUrl
  //    ("lib/db"), or an npm package ("react"). Only the first two live in the workspace.
  const config = loadImportConfig(fromFile, ctx);
  return config ? resolveWithConfig(specifier, config, ctx, codeExtensions) : undefined;
}

function resolveWithConfig(
  specifier: string,
  config: ImportConfig,
  ctx: ResolveContext,
  codeExtensions: readonly string[],
): string | undefined {
  // Aliases first. If one matches, its targets are the only candidates (like TypeScript does).
  const targets = config.paths ? targetsForAlias(specifier, config.paths) : undefined;
  if (targets) {
    for (const target of targets) {
      const found = resolveFile(join(config.pathsBase ?? '', target), ctx, codeExtensions);
      if (found) {
        return found; // several targets are fallbacks: the first that exists wins
      }
    }
    return undefined;
  }

  // No alias matched: with a baseUrl, "lib/db" means <baseUrl>/lib/db.
  if (config.baseUrl !== undefined) {
    return resolveFile(join(config.baseUrl, specifier), ctx, codeExtensions);
  }
  return undefined;
}

/**
 * Find the alias pattern matching `specifier` and fill in its targets.
 *   paths: { "@/*": ["./src/*"] }, specifier "@/lib/db" -> ["./src/lib/db"]
 * With several matching patterns the one with the longest fixed prefix wins.
 */
function targetsForAlias(specifier: string, paths: Record<string, string[]>): string[] | undefined {
  let best: { prefixLength: number; targets: string[] } | undefined;

  for (const [pattern, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets)) {
      continue;
    }
    const star = pattern.indexOf('*');
    if (star === -1) {
      // Exact alias without a wildcard, e.g. "config" -> ["./src/config.ts"].
      if (pattern === specifier && (best?.prefixLength ?? -1) < pattern.length) {
        best = { prefixLength: pattern.length, targets };
      }
      continue;
    }

    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    const matches =
      specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix);
    if (matches && (best?.prefixLength ?? -1) < prefix.length) {
      const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
      best = { prefixLength: prefix.length, targets: targets.map((target) => target.replace('*', wildcard)) };
    }
  }
  return best?.targets;
}

/** Find the real file an extension-less (or compiled-name) path stands for. */
function resolveFile(base: string, ctx: ResolveContext, codeExtensions: readonly string[]): string | undefined {
  if (base.startsWith('..')) {
    return undefined; // climbed above the workspace root
  }
  const ext = posix.extname(base);
  const isCode = (path: string) => codeExtensions.includes(posix.extname(path)) && ctx.fileExists(path);

  // "./a.js" -> a.ts / a.tsx (the compiled name of a source file).
  for (const sourceExt of SOURCE_FOR_COMPILED[ext] ?? []) {
    const candidate = base.slice(0, -ext.length) + sourceExt;
    if (isCode(candidate)) {
      return candidate;
    }
  }

  // "./a.ts" exactly as written. A non-code file ("./styles.css") stops here: it exists
  // but is not something we analyze.
  if (ext !== '' && ctx.fileExists(base)) {
    return isCode(base) ? base : undefined;
  }

  // "./utils" -> utils.ts, utils.tsx, ...
  for (const tryExt of TRY_EXTENSIONS) {
    if (isCode(base + tryExt)) {
      return base + tryExt;
    }
  }

  // "./components" -> components/index.ts, ...
  for (const tryExt of TRY_EXTENSIONS) {
    const candidate = join(base, `index${tryExt}`);
    if (isCode(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function isRelative(specifier: string): boolean {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}
