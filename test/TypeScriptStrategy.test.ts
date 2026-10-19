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

  it('returns nothing for an empty file', async () => {
    const tree = await loader.parse(strategy.grammarFor('empty.ts'), '');
    try {
      expect(strategy.extract({ path: 'empty.ts', source: '', tree })).toEqual({ symbols: [], imports: [] });
    } finally {
      tree.delete();
    }
  });
});
