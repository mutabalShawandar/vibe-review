import { MarkerType, type Edge, type Node } from '@xyflow/react';
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { FileRole } from '../../src/core/FrameworkStrategy';
import type { GraphModel } from '../../src/core/types';
import { edgeColor } from './layout';
import { ROLE_STYLE } from './roles';
import { ZONE_ORDER, zoneOf } from './zones';

// The overview of a whole system: one box per folder instead of one card per file, and one arrow
// per pair of folders. It is what fits on a screen when there are hundreds of files.

export const FOLDER_WIDTH = 280;
export const FOLDER_HEIGHT = 112;
const ZONE_SPACE = 100;
/** How many path segments name a folder: `app/api/users/route.ts` belongs to `app/api`. */
const DEPTH = 2;
const ROOT = '(root)';

export interface Folder {
  id: string;
  files: string[];
  changed: number;
  /** The role most of its files have, which colors the box and decides its band. */
  role: FileRole | undefined;
}

export interface FolderData extends Record<string, unknown> {
  folder: Folder;
  color?: string;
  roleLabel?: string;
  /** Names of the first few files, so a small folder tells what is in it without opening. */
  names: string[];
}
export type FolderNode = Node<FolderData, 'folder'>;

/** The folder a file belongs to, at most `DEPTH` segments deep. */
export function folderOf(path: string, depth = DEPTH): string {
  const dir = path.split('/').slice(0, -1).slice(0, depth).join('/');
  return dir || ROOT;
}

/** Group the files into folders. A folder with a single file is merged into its parent folder. */
export function groupFolders(graph: GraphModel): { folders: Folder[]; folderOfFile: Map<string, string> } {
  const members = new Map<string, string[]>();
  for (const node of graph.nodes) {
    const id = folderOf(node.id);
    members.set(id, [...(members.get(id) ?? []), node.id]);
  }
  for (const [id, files] of [...members]) {
    const parent = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : undefined;
    if (files.length < 2 && parent) {
      members.delete(id);
      members.set(parent, [...(members.get(parent) ?? []), ...files]);
    }
  }

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const folderOfFile = new Map<string, string>();
  const folders = [...members].map(([id, files]) => {
    const counts = new Map<FileRole, number>();
    for (const file of files) {
      folderOfFile.set(file, id);
      const role = byId.get(file)?.role;
      if (role && role !== 'other') {
        counts.set(role, (counts.get(role) ?? 0) + 1);
      }
    }
    const role = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    return { id, files: files.sort(), changed: files.filter((file) => byId.get(file)?.status === 'changed').length, role };
  });
  return { folders, folderOfFile };
}

const elk = new ELK();

/** Position the folder boxes in bands by zone (frontend, backend, shared) and draw the arrows between them. */
export async function layoutFolders(graph: GraphModel): Promise<{ nodes: FolderNode[]; edges: Edge[] }> {
  const { folders, folderOfFile } = groupFolders(graph);

  // How many symbol links run from one folder to another.
  const links = new Map<string, { from: string; to: string; count: number }>();
  for (const edge of graph.edges) {
    const from = folderOfFile.get(edge.from);
    const to = folderOfFile.get(edge.to);
    if (from && to && from !== to) {
      const link = links.get(`${from}\0${to}`) ?? { from, to, count: 0 };
      link.count += Math.max(1, edge.uses.length);
      links.set(`${from}\0${to}`, link);
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  let top = 0;
  for (const zone of ZONE_ORDER) {
    const band = folders.filter((folder) => zoneOf(folder.role) === zone).sort((a, b) => a.id.localeCompare(b.id));
    if (band.length === 0) {
      continue;
    }
    const ids = new Set(band.map((folder) => folder.id));
    const root: ElkNode = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.layered.spacing.nodeNodeBetweenLayers': '90',
        'elk.spacing.nodeNode': '24',
        'elk.aspectRatio': '3',
        'elk.layered.considerModelOrder.strategy': 'PREFER_NODES',
      },
      children: band.map((folder) => ({ id: folder.id, width: FOLDER_WIDTH, height: FOLDER_HEIGHT })),
      // Reversed like in the file diagram, so what is imported sits on the left.
      edges: [...links.values()]
        .filter(({ from, to }) => ids.has(from) && ids.has(to))
        .map(({ from, to }, index) => ({ id: `e${index}`, sources: [to], targets: [from] })),
    };
    const laidOut = await elk.layout(root);
    let bottom = 0;
    for (const child of laidOut.children ?? []) {
      positions.set(child.id, { x: child.x ?? 0, y: top + (child.y ?? 0) });
      bottom = Math.max(bottom, (child.y ?? 0) + FOLDER_HEIGHT);
    }
    top += bottom + ZONE_SPACE;
  }

  const nodes: FolderNode[] = folders.map((folder) => {
    const style = folder.role && folder.role !== 'other' ? ROLE_STYLE[folder.role] : undefined;
    return {
      id: folder.id,
      type: 'folder',
      position: positions.get(folder.id) ?? { x: 0, y: 0 },
      width: FOLDER_WIDTH,
      height: FOLDER_HEIGHT,
      data: { folder, color: style?.color, roleLabel: style?.label, names: folder.files.slice(0, 3).map((file) => file.slice(file.lastIndexOf('/') + 1)) },
      draggable: false,
    };
  });

  const edges: Edge[] = [...links.values()].map(({ from, to, count }) => ({
    id: `${from}->${to}`,
    source: from,
    target: to,
    type: 'smoothstep',
    style: { stroke: edgeColor(from), strokeWidth: Math.min(1.5 + Math.log2(count), 5), opacity: 0.6 },
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(from) },
  }));
  return { nodes, edges };
}
