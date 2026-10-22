import { describe, expect, it } from 'vitest';
import type { GraphModel, GraphSymbol } from '../src/core/types';
import { freshSince } from '../webview/src/fresh';

const fn = (name: string, startLine: number, endLine: number, changed = false): GraphSymbol => ({
  name,
  kind: 'function',
  startLine,
  endLine,
  changed,
  relevant: true,
});
const graphOf = (...files: [string, GraphSymbol[]][]): GraphModel => ({
  scope: 'changes',
  nodes: files.map(([id, symbols]) => ({ id, language: 'typescript', status: 'changed' as const, symbols })),
  edges: [],
  reviewOrder: [],
});

describe('freshSince', () => {
  const before = graphOf(['a.ts', [fn('one', 1, 5), fn('two', 7, 10)]], ['b.ts', [fn('x', 1, 3)]]);

  it('flags the symbols that are new or different in an edited file', () => {
    const after = graphOf(['a.ts', [fn('one', 1, 5), fn('two', 7, 12, true), fn('three', 14, 16, true)]], ['b.ts', [fn('x', 1, 3)]]);
    const fresh = freshSince(before, after, ['a.ts']);
    expect(fresh.files).toEqual(['a.ts']);
    expect([...fresh.rows.get('a.ts')!].sort()).toEqual(['three', 'two']);
  });

  it('flags nothing when nothing was touched (the first graph of a view)', () => {
    expect(freshSince(before, before, []).files).toEqual([]);
  });

  it('keeps the order of the touched files, newest first, and drops files not in the diagram', () => {
    expect(freshSince(before, before, ['b.ts', 'gone.ts', 'a.ts']).files).toEqual(['b.ts', 'a.ts']);
  });

  it('treats every symbol of a file that just appeared as fresh', () => {
    const after = graphOf(['a.ts', [fn('one', 1, 5)]], ['c.ts', [fn('y', 1, 2), fn('z', 4, 6)]]);
    expect([...freshSince(graphOf(['a.ts', [fn('one', 1, 5)]]), after, ['c.ts']).rows.get('c.ts')!].sort()).toEqual(['y', 'z']);
  });

  it('lists a touched file even when its symbols look the same', () => {
    const fresh = freshSince(before, before, ['a.ts']);
    expect(fresh.files).toEqual(['a.ts']);
    expect(fresh.rows.get('a.ts')!.size).toBe(0);
  });
});
