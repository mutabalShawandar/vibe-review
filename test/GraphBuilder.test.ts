import { describe, expect, it } from 'vitest';
import { buildGraph } from '../src/core/GraphBuilder';
import type { AnalyzedFile, ChangeSet, SymbolInfo } from '../src/core/types';

/** Shorthand: a file that imports `imports`. */
const file = (path: string, imports: string[] = [], symbols: SymbolInfo[] = []): AnalyzedFile => ({
  path,
  language: 'typescript',
  symbols,
  imports: imports.map((target) => ({ file: target, bindings: [] })),
});

const modified = (path: string, ...ranges: [number, number][]): ChangeSet[number] => ({
  path,
  kind: 'modified',
  ranges: ranges.map(([start, end]) => ({ start, end })),
});

const statuses = (graph: ReturnType<typeof buildGraph>) =>
  Object.fromEntries(graph.nodes.map((node) => [node.id, node.status]));

//   page --> button --> utils        other --> utils        lonely
const workspace = [
  file('page.tsx', ['button.tsx']),
  file('button.tsx', ['utils.ts']),
  file('utils.ts'),
  file('other.ts', ['utils.ts']),
  file('lonely.ts'),
];

describe('node status', () => {
  it('marks changed files, files that import them, and files they import', () => {
    const graph = buildGraph(workspace, [modified('button.tsx', [1, 1])], 'full');

    expect(statuses(graph)).toEqual({
      'button.tsx': 'changed',
      'page.tsx': 'dependent', // imports the change
      'utils.ts': 'dependency', // used by the change
      'other.ts': 'unchanged', // only related through utils.ts, two steps away
      'lonely.ts': 'unchanged',
    });
  });

  it('calls a file "dependent" when it is both a dependent and a dependency', () => {
    // a imports b, b imports c; both a and c are changed, so b is in the middle.
    const files = [file('a.ts', ['b.ts']), file('b.ts', ['c.ts']), file('c.ts')];
    const graph = buildGraph(files, [modified('a.ts', [1, 1]), modified('c.ts', [1, 1])], 'full');
    expect(statuses(graph)['b.ts']).toBe('dependent');
  });

  it('ignores deleted files and changes to files that were not analyzed', () => {
    const changes: ChangeSet = [
      { path: 'utils.ts', kind: 'deleted', ranges: [] },
      modified('README.md', [1, 5]),
    ];
    const graph = buildGraph(workspace, changes, 'changes');
    expect(graph.nodes).toEqual([]);
    expect(graph.reviewOrder).toEqual([]);
  });
});

describe('scope', () => {
  const changes = [modified('button.tsx', [1, 1])];

  it('"changes" shows only files connected to a change', () => {
    const graph = buildGraph(workspace, changes, 'changes');
    expect(graph.scope).toBe('changes');
    expect(graph.nodes.map((n) => n.id)).toEqual(['button.tsx', 'page.tsx', 'utils.ts']);
    expect(graph.edges).toEqual([
      { from: 'button.tsx', to: 'utils.ts', uses: [{}] },
      { from: 'page.tsx', to: 'button.tsx', uses: [{}] },
    ]);
  });

  it('"full" shows every file and every arrow', () => {
    const graph = buildGraph(workspace, changes, 'full');
    expect(graph.scope).toBe('full');
    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges).toHaveLength(3); // page->button, button->utils, other->utils
  });

  it('"full" works with no changes at all', () => {
    const graph = buildGraph(workspace, [], 'full');
    expect(graph.nodes.every((node) => node.status === 'unchanged')).toBe(true);
    expect(graph.reviewOrder).toEqual([]);
  });
});

describe('edges', () => {
  it('drops imports of files that were not analyzed and self-imports', () => {
    const graph = buildGraph([file('a.ts', ['missing.ts', 'a.ts', 'b.ts']), file('b.ts')], [modified('a.ts', [1, 1])], 'full');
    expect(graph.edges).toEqual([{ from: 'a.ts', to: 'b.ts', uses: [{}] }]);
  });
});

describe('changed symbols', () => {
  const symbols: SymbolInfo[] = [
    { name: 'first', kind: 'function', startLine: 1, endLine: 10 },
    { name: 'second', kind: 'function', startLine: 12, endLine: 20 },
    { name: 'third', kind: 'class', startLine: 22, endLine: 30 },
  ];

  it('flags symbols whose lines overlap a changed range', () => {
    const graph = buildGraph([file('a.ts', [], symbols)], [modified('a.ts', [8, 12], [30, 31])], 'full');
    expect(graph.nodes[0].symbols.map((s) => [s.name, s.changed])).toEqual([
      ['first', true], // change ends inside it
      ['second', true], // change starts on its first line
      ['third', true], // change touches its last line
    ]);
  });

  it('does not flag symbols outside the range, or symbols of unchanged files', () => {
    const graph = buildGraph([file('a.ts', [], symbols), file('b.ts', [], symbols)], [modified('a.ts', [11, 11])], 'full');
    expect(graph.nodes.find((n) => n.id === 'a.ts')!.symbols.every((s) => !s.changed)).toBe(true);
    expect(graph.nodes.find((n) => n.id === 'b.ts')!.symbols.every((s) => !s.changed)).toBe(true);
  });

  it('flags every symbol of a brand-new file', () => {
    const added: ChangeSet = [{ path: 'a.ts', kind: 'added', ranges: [{ start: 1, end: 30 }] }];
    const graph = buildGraph([file('a.ts', [], symbols)], added, 'full');
    expect(graph.nodes[0].symbols.every((s) => s.changed)).toBe(true);
  });
});

describe('changed members', () => {
  const classSymbol: SymbolInfo = {
    name: 'Service',
    kind: 'class',
    startLine: 1,
    endLine: 20,
    members: [
      { name: 'find', kind: 'method', startLine: 3, endLine: 6 },
      { name: 'save', kind: 'method', startLine: 8, endLine: 12 },
    ],
  };

  it('flags only the members a change touches, and the class that contains them', () => {
    const graph = buildGraph([file('a.ts', [], [classSymbol])], [modified('a.ts', [9, 9])], 'full');
    const service = graph.nodes[0].symbols[0];
    expect(service.changed).toBe(true);
    expect(service.members!.map((m) => [m.name, m.changed])).toEqual([
      ['find', false],
      ['save', true],
    ]);
  });

  it('keeps analysis-only data (references) out of the diagram data, but keeps the default marker', () => {
    const symbol: SymbolInfo = {
      name: 'Page',
      kind: 'component',
      startLine: 1,
      endLine: 3,
      references: ['getUsers'],
      isDefault: true,
      members: [{ name: 'run', kind: 'method', startLine: 2, endLine: 2, references: ['getUsers'] }],
    };
    const graph = buildGraph([file('a.ts', [], [symbol])], [], 'full');
    const shown = graph.nodes[0].symbols[0];
    expect('references' in shown).toBe(false);
    expect('references' in shown.members![0]).toBe(false);
    expect(shown.isDefault).toBe(true);
  });

  it('leaves symbols without members free of a members field', () => {
    const graph = buildGraph([file('a.ts', [], [{ name: 'f', kind: 'function', startLine: 1, endLine: 2 }])], [], 'full');
    expect('members' in graph.nodes[0].symbols[0]).toBe(false);
  });
});

describe('symbol links and relevance', () => {
  const sym = (name: string, references?: string[], members?: SymbolInfo[]): SymbolInfo => ({
    name,
    kind: 'function',
    startLine: 1,
    endLine: 1,
    ...(references ? { references } : {}),
    ...(members ? { members } : {}),
  });
  const binding = (imported: string) => ({ imported, local: imported, typeOnly: false, reexport: false });

  // users.ts (changed: getUsers) <- page.tsx (UsersPage uses getUsers, Footer uses nothing)
  //                              <- other.ts (Other uses deleteUser, which was NOT changed)
  const users: AnalyzedFile = {
    ...file('users.ts', [], [], ),
    symbols: [{ ...sym('getUsers'), startLine: 1, endLine: 5 }, { ...sym('deleteUser'), startLine: 10, endLine: 15 }],
  };
  const page: AnalyzedFile = {
    ...file('page.tsx'),
    symbols: [sym('UsersPage', ['getUsers']), sym('Footer')],
    imports: [{ file: 'users.ts', bindings: [binding('getUsers')] }],
  };
  const other: AnalyzedFile = {
    ...file('other.ts'),
    symbols: [sym('Other', ['deleteUser'])],
    imports: [{ file: 'users.ts', bindings: [binding('deleteUser')] }],
  };
  const files = [users, page, other];
  const changes = [modified('users.ts', [2, 3])];

  it('describes each arrow by the symbols involved', () => {
    const graph = buildGraph(files, changes, 'changes');
    expect(graph.edges.find((e) => e.from === 'page.tsx')!.uses).toEqual([
      { from: { symbol: 'UsersPage' }, to: { symbol: 'getUsers' } },
    ]);
  });

  it('shows every symbol of a changed file as relevant', () => {
    const node = buildGraph(files, changes, 'changes').nodes.find((n) => n.id === 'users.ts')!;
    expect(node.symbols.map((s) => [s.name, s.changed, s.relevant])).toEqual([
      ['getUsers', true, true],
      ['deleteUser', false, true], // not changed, but a changed file lists everything it declares
    ]);
  });

  it('marks only the symbols connected to a change as relevant in other files', () => {
    const graph = buildGraph(files, changes, 'changes');
    const pageNode = graph.nodes.find((n) => n.id === 'page.tsx')!;
    expect(pageNode.symbols.map((s) => [s.name, s.relevant])).toEqual([
      ['UsersPage', true], // uses getUsers from the changed file
      ['Footer', false], // unrelated to the change
    ]);
  });

  it('is relevant also when the other file is the one that changed (symbols a change depends on)', () => {
    // page.tsx changed; it uses getUsers from users.ts, which is NOT changed
    const graph = buildGraph(files, [modified('page.tsx', [1, 1])], 'changes');
    const usersNode = graph.nodes.find((n) => n.id === 'users.ts')!;
    expect(usersNode.status).toBe('dependency');
    expect(usersNode.symbols.map((s) => [s.name, s.relevant])).toEqual([
      ['getUsers', true], // used by the changed file
      ['deleteUser', false],
    ]);
  });

  it('marks nothing relevant in files that only link to other untouched files (full view)', () => {
    const graph = buildGraph(files, [], 'full');
    expect(graph.nodes.flatMap((n) => n.symbols).every((s) => !s.relevant)).toBe(true);
  });

  it('makes a class relevant when one of its members is', () => {
    const service = sym('Service', ['getUsers'], [sym('list', ['getUsers']), sym('idle')]);
    const consumer: AnalyzedFile = {
      ...file('consumer.ts'),
      symbols: [service],
      imports: [{ file: 'users.ts', bindings: [binding('getUsers')] }],
    };
    const node = buildGraph([users, consumer], changes, 'changes').nodes.find((n) => n.id === 'consumer.ts')!;
    expect(node.symbols[0].relevant).toBe(true);
    expect(node.symbols[0].members!.map((m) => [m.name, m.relevant])).toEqual([
      ['list', true],
      ['idle', false],
    ]);
  });
});

describe('review order', () => {
  const edit = (...paths: string[]) => paths.map((path) => modified(path, [1, 1]));

  it('puts foundations before the files that use them', () => {
    // page --> button --> utils, all changed
    const graph = buildGraph(workspace, edit('page.tsx', 'button.tsx', 'utils.ts'), 'changes');
    expect(graph.reviewOrder).toEqual(['utils.ts', 'button.tsx', 'page.tsx']);
  });

  it('only lists changed files, not their dependents or dependencies', () => {
    const graph = buildGraph(workspace, edit('button.tsx'), 'changes');
    expect(graph.reviewOrder).toEqual(['button.tsx']);
  });

  it('among independent files, starts with the one most files import', () => {
    const files = [file('a.ts'), file('b.ts'), file('x.ts', ['b.ts']), file('y.ts', ['b.ts']), file('z.ts', ['a.ts'])];
    const graph = buildGraph(files, edit('a.ts', 'b.ts'), 'changes');
    expect(graph.reviewOrder).toEqual(['b.ts', 'a.ts']); // b has 2 importers, a has 1
  });

  it('breaks ties by path so the order is stable', () => {
    const graph = buildGraph([file('b.ts'), file('a.ts')], edit('b.ts', 'a.ts'), 'changes');
    expect(graph.reviewOrder).toEqual(['a.ts', 'b.ts']);
  });

  it('terminates on circular imports and still lists every file', () => {
    const files = [file('a.ts', ['b.ts']), file('b.ts', ['a.ts']), file('c.ts', ['a.ts'])];
    const graph = buildGraph(files, edit('a.ts', 'b.ts', 'c.ts'), 'changes');
    expect([...graph.reviewOrder].sort()).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});

describe('entry points', () => {
  it('carries the strategy label onto the node only when there is one', () => {
    const files: AnalyzedFile[] = [{ ...file('page.tsx'), entryPoint: 'Next.js page' }, file('util.ts')];
    const graph = buildGraph(files, [], 'full');
    expect(graph.nodes.find((n) => n.id === 'page.tsx')!.entryPoint).toBe('Next.js page');
    expect('entryPoint' in graph.nodes.find((n) => n.id === 'util.ts')!).toBe(false);
  });
});
