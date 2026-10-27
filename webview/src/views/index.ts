import type { GraphModel } from '../../../src/core/types';
import { filesView } from './filesView';
import { foldersView } from './foldersView';
import type { ViewRenderer } from './ViewRenderer';

/** A renderer with its own state type, as the registry holds them side by side. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyViewRenderer = ViewRenderer<any>;

/**
 * The ONLY place views are registered. To add a kind of view: implement ViewRenderer in
 * webview/src/views/, add its node components to `nodeTypes.ts`, and add one line below.
 */
const renderers: AnyViewRenderer[] = [filesView, foldersView];

/** The renderer for a kind of view. Throws for an unknown kind: that is a bug in the caller, not in the data. */
export function rendererFor(kind: string): AnyViewRenderer {
  const renderer = renderers.find((candidate) => candidate.kind === kind);
  if (!renderer) {
    throw new Error(`Unknown view "${kind}"`);
  }
  return renderer;
}

/**
 * Which view shows a graph. Changes is small enough to show file by file; Full System groups files
 * into folder boxes. This is the single place that decides, so a view picker can replace it later.
 */
export function viewKindFor(graph: GraphModel): string {
  return graph.scope === 'full' ? foldersView.kind : filesView.kind;
}
