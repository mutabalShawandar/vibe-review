import type { GraphModel, GraphNode, GraphSymbol } from '../../src/core/types';
import { portKey } from './card';

/** What was just edited: the files (newest first) and, per file, the rows (symbols or members) that are new or different. */
export interface Fresh {
  files: string[];
  rows: Map<string, Set<string>>;
}

/**
 * Compare two graphs of the same workspace and say what the last edits touched.
 * `touched` comes from the extension (files it had to parse again). A symbol counts as fresh when
 * it is new, or its lines or changed-flag differ from before; a file that is new in the diagram
 * has all its symbols fresh. A touched file whose symbols look the same is still listed as a file.
 */
export function freshSince(previous: GraphModel, next: GraphModel, touched: readonly string[]): Fresh {
  const before = new Map(previous.nodes.map((node) => [node.id, node]));
  const inGraph = new Set(next.nodes.map((node) => node.id));
  const files = touched.filter((file) => inGraph.has(file));

  const rows = new Map<string, Set<string>>();
  for (const file of files) {
    const node = next.nodes.find((candidate) => candidate.id === file)!;
    rows.set(file, differingRows(before.get(file), node));
  }
  return { files, rows };
}

const signature = (symbol: GraphSymbol) => `${symbol.kind}:${symbol.startLine}-${symbol.endLine}:${symbol.changed}`;

function differingRows(before: GraphNode | undefined, after: GraphNode): Set<string> {
  const old = new Map<string, string>();
  const collect = (symbols: GraphSymbol[], into: Map<string, string>, parent?: string) => {
    for (const symbol of symbols) {
      into.set(portKey(parent ?? symbol.name, parent ? symbol.name : undefined), signature(symbol));
      collect(symbol.members ?? [], into, symbol.name);
    }
  };
  collect(before?.symbols ?? [], old);

  const now = new Map<string, string>();
  collect(after.symbols, now);

  const different = new Set<string>();
  for (const [key, sig] of now) {
    if (old.get(key) !== sig) {
      different.add(key);
    }
  }
  return different;
}
