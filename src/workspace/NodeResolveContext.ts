import { readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import type { ResolveContext } from '../core/LanguageStrategy';

/** ResolveContext backed by the real filesystem. Paths are relative to the workspace root. */
export class NodeResolveContext implements ResolveContext {
  constructor(private readonly root: string) {}

  fileExists(relativePath: string): boolean {
    try {
      return statSync(path.join(this.root, relativePath)).isFile();
    } catch {
      return false; // missing, or no permission: either way it is not a usable file
    }
  }

  readFile(relativePath: string): string | undefined {
    try {
      return readFileSync(path.join(this.root, relativePath), 'utf8');
    } catch {
      return undefined;
    }
  }
}
