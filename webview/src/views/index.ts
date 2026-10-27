import type { GraphModel } from '../../../src/core/types';
import { filesView } from './filesView';
import { foldersView } from './foldersView';
import { routesView } from './routesView';
import type { ViewRenderer } from './ViewRenderer';

/** A renderer with its own state type, as the registry holds them side by side. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyViewRenderer = ViewRenderer<any>;

/**
 * The ONLY place views are registered. To add a kind of view: implement ViewRenderer in
 * webview/src/views/, add its node components to `nodeTypes.ts`, and add one line below.
 */
const renderers: AnyViewRenderer[] = [filesView, foldersView, routesView];

/** The renderer for a kind of view. Throws for an unknown kind: that is a bug in the caller, not in the data. */
export function rendererFor(kind: string): AnyViewRenderer {
  const renderer = renderers.find((candidate) => candidate.kind === kind);
  if (!renderer) {
    throw new Error(`Unknown view "${kind}"`);
  }
  return renderer;
}

/** The views that can show this graph, in the order the picker lists them. The first one is the default. */
export const viewsFor = (graph: GraphModel): AnyViewRenderer[] => renderers.filter((renderer) => renderer.isAvailable(graph));

/**
 * Which view shows a graph: the one the reader picked if it can show it, otherwise the default for
 * the scope (Changes file by file, Full System in folders).
 */
export function viewKindFor(graph: GraphModel, chosen?: string): string {
  const available = viewsFor(graph);
  return available.find((renderer) => renderer.kind === chosen)?.kind ?? available[0].kind;
}
