import type { GraphNode } from '../../src/core/types';

/** One URL segment of a framework that routes by file, with the files that make up that route. */
export interface RouteNode {
  /** Unique across projects: the route alone ("/") would collide in a monorepo with two apps. */
  id: string;
  /** The project folder ("" for the workspace root). */
  project: string;
  /** The full URL path: "/users/[id]". */
  route: string;
  /** Its last part, "[id]", or "/" for the root. */
  segment: string;
  /** The id of the route above, undefined for a root. */
  parent?: string;
  /** Ids of the routes below, sorted by segment. */
  children: string[];
  /** The files of exactly this route (page, layout, loading...), in the order a request meets them. */
  files: GraphNode[];
}

export interface RouteTree {
  nodes: Map<string, RouteNode>;
  /** The root route of each project, sorted by project folder. */
  roots: string[];
  /** Files no framework gave a route: components, libraries, config. */
  other: GraphNode[];
}

export const routeNodeId = (project: string, route: string) => `route:${project}|${route}`;
/** The id of the card that lists the files outside every route. */
export const OTHER_ID = 'route:other';

// The order in which a request meets the files of one route: the wrappers first, the page or handler last.
const ROLE_ORDER = ['layout', 'template', 'loading', 'error', 'not-found', 'default', 'page', 'route handler', 'api route'];
const roleRank = (node: GraphNode) => {
  const role = (node.entryPoint ?? '').toLowerCase();
  const index = ROLE_ORDER.findIndex((name) => role.includes(name));
  return index === -1 ? ROLE_ORDER.length : index;
};

/**
 * Arrange the files that have a route into a tree of URL segments. A segment nobody wrote a file
 * for (`/users` when only `/users/[id]/page.tsx` exists) is still a node, so the tree has no gaps.
 */
export function buildRouteTree(files: readonly GraphNode[]): RouteTree {
  const nodes = new Map<string, RouteNode>();
  const other: GraphNode[] = [];

  const ensure = (project: string, route: string): RouteNode => {
    const id = routeNodeId(project, route);
    const known = nodes.get(id);
    if (known) {
      return known;
    }
    const segments = route.split('/').filter(Boolean);
    const node: RouteNode = { id, project, route, segment: segments[segments.length - 1] ?? '/', children: [], files: [] };
    nodes.set(id, node);
    if (segments.length > 0) {
      const parent = ensure(project, `/${segments.slice(0, -1).join('/')}`);
      node.parent = parent.id;
      parent.children.push(id);
    }
    return node;
  };

  for (const file of files) {
    if (file.route === undefined) {
      other.push(file);
    } else {
      ensure(file.project ?? '', file.route).files.push(file);
    }
  }

  for (const node of nodes.values()) {
    node.children.sort((a, b) => nodes.get(a)!.segment.localeCompare(nodes.get(b)!.segment));
    node.files.sort((a, b) => roleRank(a) - roleRank(b) || a.id.localeCompare(b.id));
  }
  const roots = [...nodes.values()]
    .filter((node) => node.parent === undefined)
    .sort((a, b) => a.project.localeCompare(b.project))
    .map((node) => node.id);
  return { nodes, roots, other };
}

/** The routes to draw: everything except what sits below a collapsed route. */
export function visibleRoutes(tree: RouteTree, collapsed: ReadonlySet<string>): RouteNode[] {
  const shown: RouteNode[] = [];
  const walk = (id: string) => {
    const node = tree.nodes.get(id)!;
    shown.push(node);
    if (!collapsed.has(id)) {
      node.children.forEach(walk);
    }
  };
  tree.roots.forEach(walk);
  return shown;
}

/** Every route above this one, nearest first. */
export function ancestorsOf(tree: RouteTree, id: string): string[] {
  const chain: string[] = [];
  for (let parent = tree.nodes.get(id)?.parent; parent !== undefined; parent = tree.nodes.get(parent)?.parent) {
    chain.push(parent);
  }
  return chain;
}

/** The route a file belongs to, or undefined when it has none. */
export const routeOfFile = (tree: RouteTree, fileId: string): RouteNode | undefined =>
  [...tree.nodes.values()].find((node) => node.files.some((file) => file.id === fileId));
