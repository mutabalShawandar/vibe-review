import type { GraphNode } from '../../src/core/types';
import { splitPath } from './card';

/** One box in the diagram: the files that live directly in one folder. */
export interface Group {
  /** The folder's full path (`web/components`), "" for files at the workspace root. Unique per box. */
  key: string;
  /** What the box says: the folder's name, with just enough of its path to tell it from a box of the same name. */
  label: string;
  /** The ids (file paths) of the files in the box, in the order they were given. */
  ids: string[];
}

/** The box a file belongs to: its parent folder. Frameworks can later supply another rule, such as a role. */
export const parentFolder = (node: GraphNode): string => splitPath(node.id).folder;

/**
 * Put every file into exactly one box. Boxes are keyed by the full folder path, so `web/components`
 * and `admin/components` stay apart even though both are called "components". Sorted by key so the
 * layout does not jump around between refreshes.
 */
export function groupNodes(nodes: readonly GraphNode[], groupOf: (node: GraphNode) => string = parentFolder): Group[] {
  const byKey = new Map<string, string[]>();
  for (const node of nodes) {
    const key = groupOf(node);
    byKey.set(key, [...(byKey.get(key) ?? []), node.id]);
  }
  const keys = [...byKey.keys()].sort((a, b) => a.localeCompare(b));
  const labels = labelsFor(keys);
  return keys.map((key) => ({ key, label: labels.get(key)!, ids: byKey.get(key)! }));
}

/**
 * The short label of each folder: its last segment, extended with parent segments only while
 * another folder would read the same. `web/components` and `admin/components` become themselves;
 * a lone `src/lib` is just `lib`.
 */
function labelsFor(keys: readonly string[]): Map<string, string> {
  const segments = new Map(keys.map((key) => [key, key.split('/').filter(Boolean)]));
  const labelAt = (key: string, depth: number) => segments.get(key)!.slice(-depth).join('/') || '(root)';

  const labels = new Map<string, string>();
  for (const key of keys) {
    let depth = 1;
    const max = segments.get(key)!.length;
    // Grow the label until no other folder has the same one, or the whole path is used.
    while (depth < max && keys.some((other) => other !== key && labelAt(other, depth) === labelAt(key, depth))) {
      depth++;
    }
    labels.set(key, labelAt(key, depth));
  }
  return labels;
}
