import type { GraphModel } from '../../src/core/types';
import { splitPath } from './card';

// Where to start reviewing. The changed files are split into "features": groups of changed files
// that import each other (directly). Each feature gets its own reading order and its own
// "start here", so a change that touches two unrelated things shows two starting points, not one.

export interface ReviewItem {
  /** The file path (the card id). */
  id: string;
  /** 1 is the start of its feature. */
  order: number;
  /** One line on why the file sits here. */
  reason: string;
}

export interface Feature {
  /** The id of the feature's first file; stable enough to key a list. */
  id: string;
  /** What the feature is about: the folder its files share, or else its first file. */
  title: string;
  items: ReviewItem[];
}

/**
 * Group the review order into features. `graph.reviewOrder` already puts foundations first, so
 * each feature just keeps that order for its own files. Features are listed by where their
 * first file comes in the overall order.
 */
export function computeFeatures(graph: GraphModel): Feature[] {
  const changed = graph.reviewOrder;
  const parent = new Map(changed.map((id) => [id, id]));
  const root = (id: string): string => {
    let top = id;
    while (parent.get(top) !== top) {
      top = parent.get(top)!;
    }
    parent.set(id, top); // shorten the path for next time
    return top;
  };
  for (const edge of graph.edges) {
    if (parent.has(edge.from) && parent.has(edge.to)) {
      parent.set(root(edge.from), root(edge.to));
    }
  }

  const groups = new Map<string, string[]>();
  for (const id of changed) {
    groups.set(root(id), [...(groups.get(root(id)) ?? []), id]);
  }

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const countChanged = (id: string) => {
    const count = (symbols: { changed: boolean; members?: unknown[] }[]): number =>
      symbols.reduce((sum, s) => sum + (s.changed ? 1 : 0) + count((s.members ?? []) as typeof symbols), 0);
    return count(nodes.get(id)?.symbols ?? []);
  };

  return [...groups.values()].map((files) => {
    const inFeature = new Set(files);
    const items = files.map((id, index): ReviewItem => {
      const node = nodes.get(id);
      const usedBy = graph.edges.filter((edge) => edge.to === id).length;
      const buildsOn = graph.edges.filter((edge) => edge.from === id && inFeature.has(edge.to)).length;
      const symbols = countChanged(id);

      const parts: string[] = [];
      if (node?.entryPoint) {
        parts.push(node.entryPoint);
      }
      parts.push(symbols > 0 ? `${symbols} changed ${symbols === 1 ? 'symbol' : 'symbols'}` : 'file changed');
      parts.push(usedBy > 0 ? `used by ${usedBy} ${usedBy === 1 ? 'file' : 'files'}` : 'nothing uses it');
      if (index === 0 && files.length > 1) {
        parts.push('read it first, the rest builds on it');
      } else if (buildsOn > 0) {
        parts.push(`builds on ${buildsOn} changed ${buildsOn === 1 ? 'file' : 'files'}`);
      }
      return { id, order: index + 1, reason: parts.join(' · ') };
    });
    return { id: files[0], title: titleOf(files), items };
  });
}

/** The folder all the files share, or the first file's name when they share none. */
function titleOf(files: string[]): string {
  if (files.length === 1) {
    return splitPath(files[0]).name;
  }
  const folders = files.map((file) => splitPath(file).folder.split('/').filter(Boolean));
  const shared: string[] = [];
  for (let depth = 0; depth < Math.min(...folders.map((f) => f.length)); depth++) {
    if (folders.every((folder) => folder[depth] === folders[0][depth])) {
      shared.push(folders[0][depth]);
    } else {
      break;
    }
  }
  const first = splitPath(files[0]).name;
  if (shared.length > 0) {
    return shared.join('/');
  }
  return files.length > 1 ? `${first} +${files.length - 1}` : first;
}
