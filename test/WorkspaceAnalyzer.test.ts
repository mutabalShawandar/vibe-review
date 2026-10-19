import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../src/languages';
import { ParserLoader } from '../src/parser/ParserLoader';
import { WorkspaceAnalyzer } from '../src/workspace/WorkspaceAnalyzer';

const nodeModules = path.resolve(__dirname, '../node_modules');
const parser = new ParserLoader((name) =>
  name === 'tree-sitter.wasm'
    ? path.join(nodeModules, 'web-tree-sitter', name)
    : path.join(nodeModules, 'tree-sitter-wasms', 'out', name),
);

// These tests run on a real throwaway git repository.
let dir: string;
const write = (file: string, content: string) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content);
};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'vibe-review-ws-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
});
afterEach(() => {
  vi.restoreAllMocks();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // best-effort cleanup of a temp folder
  }
});

const analyzer = () => new WorkspaceAnalyzer(dir, createRegistry(), parser);

describe('WorkspaceAnalyzer', () => {
  it('analyzes code files and resolves imports between them', async () => {
    write('tsconfig.json', '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }');
    write('src/page.tsx', `import { db } from '@/lib/db';\nimport React from 'react';\nexport default function Page() {}\n`);
    write('src/lib/db.ts', `export const db = 1;\n`);

    const { files, skipped } = await analyzer().analyze();

    expect(skipped).toEqual([]);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(Object.keys(byPath).sort()).toEqual(['src/lib/db.ts', 'src/page.tsx']);
    expect(byPath['src/page.tsx'].imports).toEqual([
      { file: 'src/lib/db.ts', bindings: [{ imported: 'db', local: 'db', typeOnly: false, reexport: false }] },
    ]); // "react" is external
    expect(byPath['src/page.tsx'].symbols.map((s) => s.name)).toEqual(['Page']);
    expect(byPath['src/lib/db.ts'].language).toBe('typescript');
  });

  it('ignores files without a strategy and anything in .gitignore', async () => {
    write('.gitignore', 'node_modules/\ndist/\n');
    write('a.ts', 'export const a = 1;\n');
    write('script.py', 'x = 1\n'); // no Python strategy yet
    write('node_modules/pkg/index.ts', 'export const x = 1;\n');
    write('dist/out.js', 'var x = 1;\n');

    const { files } = await analyzer().analyze();
    expect(files.map((f) => f.path)).toEqual(['a.ts']);
  });

  it('does not resolve imports into ignored folders', async () => {
    write('.gitignore', 'generated/\n');
    write('a.ts', `import { g } from './generated/g';\n`);
    write('generated/g.ts', 'export const g = 1;\n');

    const { files } = await analyzer().analyze();
    expect(files.find((f) => f.path === 'a.ts')!.imports).toEqual([]);
  });

  it('reports a file that cannot be parsed in "skipped" and keeps the others', async () => {
    write('good.ts', 'export const a = 1;\n');
    write('bad.ts', 'export const b = 1;\n');
    const real = parser.parse.bind(parser);
    vi.spyOn(parser, 'parse').mockImplementation(async (grammar, source) => {
      if (source.includes('const b')) {
        throw new Error('boom');
      }
      return real(grammar, source);
    });

    const { files, skipped } = await analyzer().analyze();
    expect(files.map((f) => f.path)).toEqual(['good.ts']);
    expect(skipped).toEqual([{ path: 'bad.ts', reason: 'boom' }]);
  });

  it('skips files that git lists but that no longer exist', async () => {
    write('a.ts', 'export const a = 1;\n');
    write('gone.ts', 'export const g = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    rmSync(path.join(dir, 'gone.ts'));

    const { files, skipped } = await analyzer().analyze();
    expect(files.map((f) => f.path)).toEqual(['a.ts']);
    expect(skipped).toEqual([]);
  });

  it('only re-parses files that changed since the last scan', async () => {
    write('a.ts', 'export const a = 1;\n');
    write('b.ts', 'export const b = 1;\n');
    const scanner = analyzer();
    await scanner.analyze();

    const parse = vi.spyOn(parser, 'parse');
    await scanner.analyze();
    expect(parse).toHaveBeenCalledTimes(0); // nothing changed

    write('b.ts', 'export const b = 22;\nexport const c = 3;\n');
    const later = new Date(Date.now() + 5000); // make sure the modification time differs
    utimesSync(path.join(dir, 'b.ts'), later, later);

    const { files } = await scanner.analyze();
    expect(parse).toHaveBeenCalledTimes(1); // only b.ts
    expect(files.find((f) => f.path === 'b.ts')!.symbols.map((s) => s.name)).toEqual(['b', 'c']);
  });

  it('picks up import changes in an unchanged file when another file appears', async () => {
    write('a.ts', `import { b } from './b';\n`);
    const scanner = analyzer();
    expect((await scanner.analyze()).files[0].imports).toEqual([]); // b.ts does not exist yet

    write('b.ts', 'export const b = 1;\n');
    const { files } = await scanner.analyze();
    expect(files.find((f) => f.path === 'a.ts')!.imports.map((i) => i.file)).toEqual(['b.ts']);
  });

  it('reports progress', async () => {
    write('a.ts', 'export const a = 1;\n');
    write('b.ts', 'export const b = 1;\n');
    const progress: [number, number][] = [];
    await analyzer().analyze((done, total) => progress.push([done, total]));
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});
