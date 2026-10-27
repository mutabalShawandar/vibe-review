import { MarkerType, type Edge } from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { GraphModel, GraphNode } from '../../../src/core/types';
import { ROW_HEIGHT } from '../card';
import type { RouteFlowNode } from '../layout';
import { ancestorsOf, buildRouteTree, OTHER_ID, routeOfFile, visibleRoutes, type RouteNode, type RouteTree } from '../routes';
import type { ViewElements, ViewRenderer } from './ViewRenderer';

/** The routes the reader folded away (by route id). Everything below them is hidden. */
export type CollapsedRoutes = ReadonlySet<string>;

export const ROUTE_CARD_WIDTH = 320;
export const ROUTE_HEADER = 52;
const ROUTE_PADDING = 6;
/** The card of files outside every route lists at most this many of the files that matter to a review. */
const OTHER_ROWS = 8;

const treeOf = (graph: GraphModel): RouteTree => buildRouteTree(graph.nodes);
const hasRoutes = (graph: GraphModel) => graph.nodes.some((node) => node.route !== undefined);
const rowsHeight = (rows: number) => ROUTE_HEADER + rows * ROW_HEIGHT + ROUTE_PADDING;

const elk = new ELK();

/**
 * The URL tree of a framework that routes by file (Next.js): one card per URL segment, listing the
 * files that make it up, with the segments below it to its right. Files that no framework gave a
 * route sit in a card of their own, so a change to a component or a library is never out of sight.
 */
export const routesView: ViewRenderer<CollapsedRoutes> = {
  kind: 'routes',
  label: 'Routes',
  initialState: new Set(),
  isAvailable: hasRoutes,

  async layout(graph, _expanded, collapsed): Promise<ViewElements> {
    const tree = treeOf(graph);
    const routes = visibleRoutes(tree, collapsed);
    const multipleProjects = tree.roots.length > 1;

    const nodes: RouteFlowNode[] = routes.map((route) => routeCard(route, collapsed, multipleProjects));
    const outside = otherCard(tree.other);
    if (outside) {
      nodes.push(outside);
    }

    const edges: Edge[] = routes.flatMap((route) =>
      collapsed.has(route.id)
        ? []
        : route.children.map((child) => ({
            id: `${route.id}->${child}`,
            source: route.id,
            target: child,
            sourceHandle: 'out',
            targetHandle: 'in',
            type: 'smoothstep',
            style: { stroke: 'var(--vscode-panel-border, #888)' },
            markerEnd: { type: MarkerType.ArrowClosed },
          })),
    );

    const laidOut = await elk.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.layered.spacing.nodeNodeBetweenLayers': '70',
        'elk.spacing.nodeNode': '24',
      },
      children: nodes.map((node) => ({ id: node.id, width: ROUTE_CARD_WIDTH, height: node.height })),
      edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
    });
    const at = new Map((laidOut.children ?? []).map((child) => [child.id, child]));
    return {
      nodes: nodes.map((node) => ({ ...node, position: { x: at.get(node.id)?.x ?? 0, y: at.get(node.id)?.y ?? 0 } })),
      edges,
    };
  },

  toggleNode(graph, collapsed, nodeId) {
    const route = treeOf(graph).nodes.get(nodeId);
    if (!route || route.children.length === 0) {
      return collapsed;
    }
    const next = new Set(collapsed);
    if (!next.delete(nodeId)) {
      next.add(nodeId);
    }
    return next;
  },

  reveal(graph, collapsed, fileId) {
    const tree = treeOf(graph);
    const route = routeOfFile(tree, fileId);
    const folded = route ? ancestorsOf(tree, route.id).filter((id) => collapsed.has(id)) : [];
    return folded.length > 0 ? new Set([...collapsed].filter((id) => !folded.includes(id))) : collapsed;
  },

  nodeFor(graph, fileId) {
    const node = graph.nodes.find((candidate) => candidate.id === fileId);
    if (!node) {
      return fileId;
    }
    return node.route === undefined ? OTHER_ID : (routeOfFile(treeOf(graph), fileId)?.id ?? fileId);
  },
};

function routeCard(route: RouteNode, collapsed: CollapsedRoutes, showProject: boolean): RouteFlowNode {
  return {
    id: route.id,
    type: 'routeCard',
    position: { x: 0, y: 0 },
    width: ROUTE_CARD_WIDTH,
    height: rowsHeight(route.files.length),
    className: route.files.some((file) => file.status === 'changed') ? 'status-changed' : undefined,
    data: {
      title: route.route,
      ...(showProject ? { project: route.project || '(root)' } : {}),
      files: route.files,
      hiddenFiles: 0,
      ...(route.children.length > 0 ? { fold: { children: route.children.length, collapsed: collapsed.has(route.id) } } : {}),
      changedCount: route.files.filter((file) => file.status === 'changed').length,
    },
  };
}

/** A card for the files outside every route, listing the ones that matter to a review: changed, or touching a change. */
function otherCard(files: readonly GraphNode[]): RouteFlowNode | undefined {
  if (files.length === 0) {
    return undefined;
  }
  const relevant = files.filter((file) => file.status !== 'unchanged');
  const listed = relevant.slice(0, OTHER_ROWS);
  return {
    id: OTHER_ID,
    type: 'routeCard',
    position: { x: 0, y: 0 },
    width: ROUTE_CARD_WIDTH,
    height: rowsHeight(listed.length + (files.length > listed.length ? 1 : 0)),
    className: relevant.some((file) => file.status === 'changed') ? 'status-changed' : undefined,
    data: {
      title: 'Not in a route',
      files: listed,
      hiddenFiles: files.length - listed.length,
      changedCount: files.filter((file) => file.status === 'changed').length,
    },
  };
}
