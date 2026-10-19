import { parse } from 'jsonc-parser';
import { posix } from 'node:path';
import type { ResolveContext } from '../../core/LanguageStrategy';

/**
 * The parts of tsconfig.json / jsconfig.json that decide what an import like "@/lib/db"
 * points to. All paths are workspace-relative with forward slashes ('' is the workspace root).
 */
export interface ImportConfig {
  /** Folder that bare imports like "lib/db" resolve against (compilerOptions.baseUrl). */
  baseUrl?: string;
  /** Alias patterns, e.g. { "@/*": ["./src/*"] } (compilerOptions.paths). */
  paths?: Record<string, string[]>;
  /** Folder the targets in `paths` are relative to. */
  pathsBase?: string;
}

const CONFIG_NAMES = ['tsconfig.json', 'jsconfig.json'];

// Guards against a config that (wrongly) extends itself.
const MAX_EXTENDS_DEPTH = 10;

/** Walk up from a file's folder to the workspace root and return the first config found. */
export function findConfigFile(fromFile: string, ctx: ResolveContext): string | undefined {
  let dir = dirOf(fromFile);
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name);
      if (ctx.fileExists(candidate)) {
        return candidate;
      }
    }
    if (dir === '') {
      return undefined; // reached the workspace root without finding one
    }
    dir = dirOf(dir);
  }
}

/** Read the config for a file: the nearest tsconfig/jsconfig, including what it `extends`. */
export function loadImportConfig(fromFile: string, ctx: ResolveContext): ImportConfig | undefined {
  const configPath = findConfigFile(fromFile, ctx);
  return configPath ? readConfig(configPath, ctx, 0) : undefined;
}

function readConfig(configPath: string, ctx: ResolveContext, depth: number): ImportConfig {
  const text = ctx.readFile(configPath);
  // tsconfig.json allows comments and trailing commas, so a plain JSON.parse would fail.
  const json = text === undefined ? undefined : parse(text, [], { allowTrailingComma: true });
  const configDir = dirOf(configPath);
  const options = json?.compilerOptions ?? {};

  // Start from the parent config (if any); this file's own options then override it.
  const inherited = depth < MAX_EXTENDS_DEPTH ? readParentConfig(json?.extends, configDir, ctx, depth) : {};
  const result: ImportConfig = { ...inherited };

  if (typeof options.baseUrl === 'string') {
    result.baseUrl = join(configDir, options.baseUrl);
  }
  if (options.paths && typeof options.paths === 'object') {
    result.paths = options.paths;
    // Targets are relative to baseUrl when there is one, otherwise to this config file.
    result.pathsBase = result.baseUrl ?? configDir;
  }
  return result;
}

/** Only relative `extends` ("../tsconfig.base.json") are followed; package presets are skipped. */
function readParentConfig(extendsValue: unknown, configDir: string, ctx: ResolveContext, depth: number): ImportConfig {
  const first = Array.isArray(extendsValue) ? extendsValue[0] : extendsValue;
  if (typeof first !== 'string' || !first.startsWith('.')) {
    return {};
  }
  let parentPath = join(configDir, first);
  if (!parentPath.endsWith('.json')) {
    parentPath += '.json';
  }
  return ctx.fileExists(parentPath) ? readConfig(parentPath, ctx, depth + 1) : {};
}

export function dirOf(path: string): string {
  return norm(posix.dirname(path));
}

export function join(...parts: string[]): string {
  return norm(posix.join(...parts));
}

/** posix.join/dirname return "." for the current folder; we use '' for the workspace root. */
function norm(path: string): string {
  return path === '.' ? '' : path;
}
