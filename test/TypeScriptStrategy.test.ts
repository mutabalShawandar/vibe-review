import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParserLoader } from '../src/parser/ParserLoader';
import { TypeScriptStrategy } from '../src/languages/typescript/TypeScriptStrategy';

const nodeModules = path.resolve(__dirname, '../node_modules');
const loader = new ParserLoader((name) =>
  name === 'tree-sitter.wasm'
    ? path.join(nodeModules, 'web-tree-sitter', name)
    : path.join(nodeModules, 'tree-sitter-wasms', 'out', name),
);
const strategy = new TypeScriptStrategy();

/** Parse a fixture file the way the real pipeline does, then extract. */
async function analyze(fixture: string) {
  const file = `test/fixtures/typescript/${fixture}`;
  const source = readFileSync(path.resolve(__dirname, '..', file), 'utf8');
  const tree = await loader.parse(strategy.grammarFor(fixture), source);
  try {
    return strategy.extract({ path: file, source, tree });
  } finally {
    tree.delete();
  }
}

const summary = (symbols: { name: string; kind: string }[]) => symbols.map((s) => `${s.kind} ${s.name}`);

describe('TypeScriptStrategy.grammarFor', () => {
  it('uses the typescript grammar for .ts and the tsx grammar for everything else', () => {
    expect(strategy.grammarFor('a.ts')).toBe('tree-sitter-typescript.wasm');
    expect(strategy.grammarFor('a.mts')).toBe('tree-sitter-typescript.wasm');
    expect(strategy.grammarFor('a.tsx')).toBe('tree-sitter-tsx.wasm');
    expect(strategy.grammarFor('a.js')).toBe('tree-sitter-tsx.wasm');
    expect(strategy.grammarFor('a.JSX')).toBe('tree-sitter-tsx.wasm');
  });
});

describe('TypeScriptStrategy.extract', () => {
  it('reads a Next.js page', async () => {
    const { symbols, imports } = await analyze('page.tsx');

    expect(imports.map((i) => [i.specifier, i.line])).toEqual([
      ['next/link', 1],
      ['@/lib/users', 2],
      ['../types', 3],
      ['./styles.css', 4], // side-effect import without bindings
    ]);
    expect(summary(symbols)).toEqual([
      'variable PAGE_SIZE',
      'component UsersPage', // `export default async function` that returns JSX
      'variable dynamic',
      'component Helper',
    ]);
  });

  it('gives each symbol its full line range, including the export keyword', async () => {
    const { symbols } = await analyze('page.tsx');
    expect(symbols.find((s) => s.name === 'UsersPage')).toMatchObject({ startLine: 8, endLine: 11 });
    expect(symbols.find((s) => s.name === 'PAGE_SIZE')).toMatchObject({ startLine: 6, endLine: 6 });
  });

  it('reads a route handler, including a dynamic import inside a function', async () => {
    const { symbols, imports } = await analyze('route.ts');

    expect(imports.map((i) => i.specifier)).toEqual(['next/server', '../../lib/db', '../../lib/audit']);
    expect(summary(symbols)).toEqual(['function GET', 'function POST']);
  });

  it('treats arrow-function variables as functions and finds classes and require()', async () => {
    const { symbols, imports } = await analyze('hook.ts');

    expect(imports.map((i) => i.specifier)).toEqual(['react', 'fs']); // import + require
    expect(summary(symbols)).toEqual([
      'variable fs', // const fs = require('fs') is a plain variable
      'hook useCounter', // arrow function named useXxx
      'variable MAX',
      'variable MIN',
      'class Store', // export default class
      'class Base', // abstract
      'class Shape', // export abstract
    ]);
  });

  it('reads a types-only module with re-exports', async () => {
    const { symbols, imports } = await analyze('types.ts');

    expect(imports.map((i) => i.specifier)).toEqual(['./other', './thing']);
    expect(summary(symbols)).toEqual([
      'interface User',
      'type Role',
      'enum Status',
      'enum Flags', // const enum
      // `declare const ambient` is intentionally not listed: ambient declarations only
      // describe types for code defined elsewhere.
    ]);
  });

  it('lists the methods and properties of classes and interfaces', async () => {
    const { symbols } = await analyze('service.ts');
    const members = (name: string) => symbols.find((s) => s.name === name)?.members?.map((m) => m.kind + ' ' + m.name);

    expect(summary(symbols)).toEqual(['interface Repository', 'class UserService', 'class Base']);
    expect(members('Repository')).toEqual([
      'property name',
      'property size', // optional and readonly are still properties
      'method find',
      // the index signature [key: string] is not a named member
    ]);
    expect(members('UserService')).toEqual([
      'property name',
      'property cache',
      'property instance', // static field
      'method constructor',
      'method find',
      'method size', // getter and setter are listed once
      'method create', // static method
    ]);
    expect(members('Base')).toEqual(['method run']); // abstract method
  });

  it('gives members their own line ranges', async () => {
    const { symbols } = await analyze('service.ts');
    const find = symbols.find((s) => s.name === 'UserService')!.members!.find((m) => m.name === 'find');
    expect(find).toMatchObject({ startLine: 17, endLine: 19 });
  });

  it('does not give functions or variables members', async () => {
    const { symbols } = await analyze('page.tsx');
    expect(symbols.every((s) => s.members === undefined)).toBe(true);
  });

  describe('import bindings', () => {
    // Turns each import into "imported->local" strings, easy to compare at a glance.
    const bindingsOf = async (fixture: string) =>
      Object.fromEntries(
        (await analyze(fixture)).imports.map((i) => [
          i.specifier,
          i.bindings.map((b) => {
            const flags = (b.typeOnly ? ' type' : '') + (b.reexport ? ' reexport' : '');
            return `${b.imported}->${b.local || '(none)'}${flags}`;
          }),
        ]),
      );

    it('reads default, named, aliased and namespace imports', async () => {
      const bindings = await bindingsOf('imports.tsx');
      expect(bindings['react']).toEqual(['default->React', 'useState->useS', 'FC->FC type']);
      expect(bindings['./db']).toEqual(['*->db']);
    });

    it('marks names of an `import type` as type-only', async () => {
      const bindings = await bindingsOf('imports.tsx');
      expect(bindings['./types']).toEqual(['User->User type', 'Role->Role type']);
    });

    it('gives a side-effect import no names', async () => {
      const bindings = await bindingsOf('imports.tsx');
      expect(bindings['./side.css']).toEqual([]);
    });

    it('reads re-exports', async () => {
      const bindings = await bindingsOf('imports.tsx');
      expect(bindings['./x']).toEqual(['a->b reexport', 'c->c reexport']);
      expect(bindings['./y']).toEqual(['*->(none) reexport']);
      expect(bindings['./z']).toEqual(['*->ns reexport']);
    });

    it('reads import = require, and require() with a name or destructuring', async () => {
      const bindings = await bindingsOf('imports.tsx');
      expect(bindings['fs']).toEqual(['*->fs']);
      expect(bindings['./m']).toEqual(['one->one', 'two->second']);
      expect(bindings['./lazy']).toEqual(['*->lazy']);
    });

    it('reads dynamic import(), with or without a name', async () => {
      const bindings = await bindingsOf('imports.tsx');
      expect(bindings['./dynamic']).toEqual(['*->lazyModule']);
      expect(bindings['./helpers']).toEqual(['helper->helper']);
      expect(bindings['./bare']).toEqual(['*->(none)']);
    });
  });

  describe('where a symbol uses an imported name', () => {
    it('records the lines each imported name is written on, inside the symbol', async () => {
      const { symbols } = await analyze('usage.tsx');
      const lines = (name: string) => symbols.find((s) => s.name === name)?.referenceLines;
      expect(lines('loadAll')).toEqual({ getUsers: [8] });
      expect(lines('remove')).toEqual({ db: [13], deleteUser: [12] });
      const service = symbols.find((s) => s.name === 'Service');
      expect(service?.members?.find((m) => m.name === 'list')?.referenceLines).toEqual({ getUsers: [26] });
    });
  });

  describe('which imported names a symbol uses', () => {
    const usageOf = async (fixture: string) =>
      Object.fromEntries((await analyze(fixture)).symbols.map((s) => [s.name, s.references]));

    it('lists the imported names each symbol uses, by local name', async () => {
      expect(await usageOf('usage.tsx')).toEqual({
        loadAll: ['getUsers'],
        remove: ['db', 'deleteUser'], // `db.query()` is a use of the namespace `db`
        Page: ['Button'], // a JSX tag counts
        Row: ['User'], // so does a type
        unrelated: undefined, // uses nothing that was imported
        Service: ['Base', 'deleteUser', 'getUsers'], // `extends Base` and everything in its methods
      });
    });

    it('lists the same for each method and property of a class', async () => {
      const { symbols } = await analyze('usage.tsx');
      const members = symbols.find((s) => s.name === 'Service')!.members!;
      expect(Object.fromEntries(members.map((m) => [m.name, m.references]))).toEqual({
        list: ['getUsers'],
        drop: ['deleteUser'],
        name: undefined,
      });
    });

    it('ignores names that are not imports', async () => {
      // page.tsx declares PAGE_SIZE itself and imports Link, getUsers and User
      const { symbols } = await analyze('page.tsx');
      const byName = Object.fromEntries(symbols.map((s) => [s.name, s.references]));
      expect(byName['UsersPage']).toEqual(['Link', 'getUsers']);
      expect(byName['Helper']).toEqual(['User']);
      expect(byName['PAGE_SIZE']).toBeUndefined();
    });

    it('does not report anything for a file without imports', async () => {
      const { symbols } = await analyze('types.ts');
      expect(symbols.every((s) => s.references === undefined)).toBe(true);
    });
  });

  describe('default exports', () => {
    it('marks `export default function`, `export default class` and `export default Name;`', async () => {
      const defaults = async (fixture: string) =>
        (await analyze(fixture)).symbols.filter((s) => s.isDefault).map((s) => s.name);

      expect(await defaults('page.tsx')).toEqual(['UsersPage']); // export default async function
      expect(await defaults('hook.ts')).toEqual(['Store']); // export default class
      expect(await defaults('usage.tsx')).toEqual(['Page']); // export default Page;
    });

    it('does not mark anything in a file without a default export', async () => {
      expect((await analyze('route.ts')).symbols.some((s) => s.isDefault)).toBe(false);
    });
  });

  it('returns nothing for an empty file', async () => {
    const tree = await loader.parse(strategy.grammarFor('empty.ts'), '');
    try {
      expect(strategy.extract({ path: 'empty.ts', source: '', tree })).toEqual({ symbols: [], imports: [] });
    } finally {
      tree.delete();
    }
  });
});
