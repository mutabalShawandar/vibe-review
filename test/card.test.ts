import { describe, expect, it } from 'vitest';
import type { GraphNode, GraphSymbol } from '../src/core/types';
import { buildCard, COLLAPSE_ABOVE } from '../webview/src/card';

const symbol = (name: string, changed: boolean): GraphSymbol => ({
  name,
  kind: 'function',
  startLine: 1,
  endLine: 2,
  changed,
  relevant: true,
});

// A big changed file: 12 functions, only f3 and f7 changed.
const names = Array.from({ length: COLLAPSE_ABOVE + 4 }, (_, i) => `f${i}`);
const big: GraphNode = {
  id: 'big.ts',
  language: 'typescript',
  status: 'changed',
  symbols: names.map((name) => symbol(name, name === 'f3' || name === 'f7')),
};
const keys = (node: GraphNode, expanded: boolean, reveal?: Set<string>) =>
  buildCard(node, expanded, reveal).rows.map((row) => row.key);

describe('buildCard', () => {
  it('collapses a big changed file to what changed in it', () => {
    const card = buildCard(big, false);
    expect(card.rows.map((r) => r.key)).toEqual(['f3', 'f7']);
    expect(card.hiddenCount).toBe(names.length - 2);
    expect(card.hasFooter).toBe(true);
  });

  it('lists every symbol once the card is expanded', () => {
    expect(keys(big, true)).toEqual(names);
  });

  it('keeps a small card as it is', () => {
    const small: GraphNode = { ...big, symbols: big.symbols.slice(0, COLLAPSE_ABOVE) };
    expect(keys(small, false)).toHaveLength(COLLAPSE_ABOVE);
  });

  it('shows hidden rows that a hovered route passes through', () => {
    expect(keys(big, false, new Set(['f5']))).toEqual(['f3', 'f5', 'f7']);
  });

  it('shows the class above a revealed member', () => {
    const cls: GraphSymbol = { ...symbol('Svc', false), kind: 'class', members: [symbol('run', false)] };
    const node: GraphNode = { ...big, symbols: [...big.symbols.slice(0, 3), cls, ...big.symbols.slice(3)] };
    expect(keys(node, false, new Set(['Svc.run']))).toContain('Svc');
    expect(keys(node, false, new Set(['Svc.run']))).toContain('Svc.run');
  });
});
