import type { GraphModel } from '../../../src/core/types';
import { groupNodes } from '../groups';
import { groupNodeId, layoutGraph, type Grouping } from '../layout';
import type { ViewRenderer } from './ViewRenderer';

/** What the reader chose per folder (by the folder's path): true is open, false is collapsed. Folders not listed use the default. */
export type FolderChoices = ReadonlyMap<string, boolean>;

/**
 * The folder boxes for a graph. A folder is open when it holds a changed file, unless the reader
 * chose otherwise, so a review starts with the changes visible and everything else folded away.
 */
export function groupingFor(graph: GraphModel, choices: FolderChoices): Grouping {
  const groups = groupNodes(graph.nodes);
  const changed = new Set(graph.nodes.filter((node) => node.status === 'changed').map((node) => node.id));
  const open = groups.filter((group) => choices.get(group.key) ?? group.ids.some((id) => changed.has(id)));
  return { groups, open: new Set(open.map((group) => group.key)) };
}

/** The folder path behind a folder node's id, or undefined for any other node. */
const folderOf = (nodeId: string): string | undefined => {
  const prefix = groupNodeId('');
  return nodeId.startsWith(prefix) ? nodeId.slice(prefix.length) : undefined;
};

/** Files inside one box per parent folder. A folder with changes is open; the others are one small card. */
export const foldersView: ViewRenderer<FolderChoices> = {
  kind: 'folders',
  label: 'Folders',
  isAvailable: (graph) => graph.scope === 'full',
  nodeFor: (_graph, fileId) => fileId, // a file inside an open folder has its own card; a closed one is revealed first
  initialState: new Map(),

  layout: (graph, expanded, choices) => layoutGraph(graph, expanded, groupingFor(graph, choices)),

  toggleNode(graph, choices, nodeId) {
    const key = folderOf(nodeId);
    if (key === undefined) {
      return choices;
    }
    return new Map(choices).set(key, !groupingFor(graph, choices).open.has(key));
  },

  reveal(graph, choices, fileId) {
    const { groups, open } = groupingFor(graph, choices);
    const group = groups.find((candidate) => candidate.ids.includes(fileId));
    return group && !open.has(group.key) ? new Map(choices).set(group.key, true) : choices;
  },
};
