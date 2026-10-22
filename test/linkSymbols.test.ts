import { describe, expect, it } from 'vitest';
import { linkImports } from '../src/core/linkSymbols';
import type { AnalyzedFile, ImportBinding, SymbolInfo, SymbolLink } from '../src/core/types';

// Small builders so each test reads like the code it describes.
const named = (imported: string, local = imported, extra: Partial<ImportBinding> = {}): ImportBinding => ({
  imported,
  local,
  typeOnly: false,
  reexport: false,
  ...extra,
});
const fn = (name: string, references?: string[], extra: Partial<SymbolInfo> = {}): SymbolInfo => ({
  name,
  kind: 'function',
  startLine: 1,
  endLine: 2,
  ...(references ? { references } : {}),
  ...extra,
});
const file = (path: string, symbols: SymbolInfo[], imports: AnalyzedFile['imports'] = []): AnalyzedFile => ({
  path,
  language: 'typescript',
  symbols,
  imports,
});

/** Links of `importer` towards the file `target` inside a workspace of the given files. */
function linksBetween(importer: AnalyzedFile, target: AnalyzedFile): SymbolLink[] | undefined {
  const byPath = new Map([importer, target].map((f) => [f.path, f]));
  return linkImports(importer, byPath).get(target.path);
}

describe('linkImports', () => {
  const users = file('users.ts', [fn('getUsers'), fn('deleteUser')]);

  it('links the symbol that uses a name to the symbol it comes from', () => {
    const page = file('page.tsx', [fn('UsersPage', ['getUsers'])], [{ file: 'users.ts', bindings: [named('getUsers')] }]);
    expect(linksBetween(page, users)).toEqual([{ from: { symbol: 'UsersPage' }, to: { symbol: 'getUsers' } }]);
  });

  it('follows an alias: the local name is searched, the imported name is linked', () => {
    const page = file('page.tsx', [fn('Page', ['fetchUsers'])], [{ file: 'users.ts', bindings: [named('getUsers', 'fetchUsers')] }]);
    expect(linksBetween(page, users)).toEqual([{ from: { symbol: 'Page' }, to: { symbol: 'getUsers' } }]);
  });

  it('makes one link per user and per name', () => {
    const page = file(
      'page.tsx',
      [fn('A', ['getUsers', 'deleteUser']), fn('B', ['getUsers'])],
      [{ file: 'users.ts', bindings: [named('getUsers'), named('deleteUser')] }],
    );
    expect(linksBetween(page, users)).toEqual([
      { from: { symbol: 'A' }, to: { symbol: 'getUsers' } },
      { from: { symbol: 'B' }, to: { symbol: 'getUsers' } },
      { from: { symbol: 'A' }, to: { symbol: 'deleteUser' } },
    ]);
  });

  it('attributes a use to the class member that makes it, not to the whole class', () => {
    const service = fn('Service', ['getUsers'], {
      kind: 'class',
      members: [fn('list', ['getUsers'], { kind: 'method' }), fn('other', undefined, { kind: 'method' })],
    });
    const page = file('s.ts', [service], [{ file: 'users.ts', bindings: [named('getUsers')] }]);
    expect(linksBetween(page, users)).toEqual([
      { from: { symbol: 'Service', member: 'list' }, to: { symbol: 'getUsers' } },
    ]);
  });

  it('attributes a use to the class itself when no member explains it (extends)', () => {
    const base = file('base.ts', [fn('Base')]);
    const service = fn('Service', ['Base'], { kind: 'class', members: [fn('run', undefined, { kind: 'method' })] });
    const page = file('s.ts', [service], [{ file: 'base.ts', bindings: [named('Base')] }]);
    expect(linksBetween(page, base)).toEqual([{ from: { symbol: 'Service' }, to: { symbol: 'Base' } }]);
  });

  it('resolves a default import to the target default export, whatever its name', () => {
    const target = file('page.tsx', [fn('UsersPage', undefined, { isDefault: true }), fn('Other')]);
    const layout = file('layout.tsx', [fn('Layout', ['Page'])], [{ file: 'page.tsx', bindings: [named('default', 'Page')] }]);
    expect(linksBetween(layout, target)).toEqual([{ from: { symbol: 'Layout' }, to: { symbol: 'UsersPage' } }]);
  });

  it('points at the whole file for a namespace import, since any symbol could be meant', () => {
    const page = file('page.tsx', [fn('Page', ['db'])], [{ file: 'users.ts', bindings: [named('*', 'db')] }]);
    expect(linksBetween(page, users)).toEqual([{ from: { symbol: 'Page' } }]);
  });

  it('points at the whole file when the imported name is not a symbol there (e.g. only re-exported)', () => {
    const barrel = file('index.ts', []);
    const page = file('page.tsx', [fn('Page', ['getUsers'])], [{ file: 'index.ts', bindings: [named('getUsers')] }]);
    expect(linksBetween(page, barrel)).toEqual([{ from: { symbol: 'Page' } }]);
  });

  it('still reports an import that no symbol uses', () => {
    const page = file('page.tsx', [fn('Page')], [{ file: 'users.ts', bindings: [named('getUsers')] }]);
    expect(linksBetween(page, users)).toEqual([{ to: { symbol: 'getUsers' } }]);
  });

  it('gives a side-effect import a plain file-level link', () => {
    const page = file('page.tsx', [fn('Page')], [{ file: 'users.ts', bindings: [] }]);
    expect(linksBetween(page, users)).toEqual([{}]);
  });

  it('ignores re-exports as uses but keeps the arrow', () => {
    const barrel = file('index.ts', [], [{ file: 'users.ts', bindings: [named('getUsers', 'getUsers', { reexport: true })] }]);
    expect(linksBetween(barrel, users)).toEqual([{}]);
  });

  it('skips imports of files that are not analyzed', () => {
    const page = file('page.tsx', [fn('Page', ['x'])], [{ file: 'missing.ts', bindings: [named('x')] }]);
    expect(linkImports(page, new Map([[page.path, page]])).size).toBe(0);
  });
});
