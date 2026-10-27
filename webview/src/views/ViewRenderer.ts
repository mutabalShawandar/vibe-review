import type { Edge } from '@xyflow/react';
import type { GraphModel } from '../../../src/core/types';
import type { FlowNode } from '../layout';

/** What a view puts on the canvas: nodes with positions and the arrows between them. */
export interface ViewElements {
  nodes: FlowNode[];
  edges: Edge[];
}

/**
 * One way of drawing a GraphModel. The app asks the active renderer where everything goes and
 * never looks at what a node stands for, so a new kind of view is one file that implements this
 * interface plus one line in `views/index.ts`.
 *
 * A renderer is made of pure functions. Whatever the reader changes in the view (which folders are
 * open, which branches are folded) lives in `State`, which the app keeps and passes back in, so
 * every transition can be unit tested without React.
 *
 * Every node `type` a renderer emits needs a component in `views/nodeTypes.ts`.
 */
export interface ViewRenderer<State = unknown> {
  /** Unique id, e.g. "files" or "folders". */
  readonly kind: string;

  /** What the view picker calls it. */
  readonly label: string;

  /** Whether this view can show the graph at all. A view that needs routes is not offered for a project without any. */
  isAvailable(graph: GraphModel): boolean;

  /** The state before the reader has changed anything. */
  readonly initialState: State;

  /**
   * Place everything. `expanded` holds the ids of file cards opened to list every symbol: file cards
   * are the one thing all views share, so that choice is not part of a view's own state.
   */
  layout(graph: GraphModel, expanded: ReadonlySet<string>, state: State): Promise<ViewElements>;

  /** The reader clicked a node that stands for several files (a folder, a branch): open or close it. Returns the new state. */
  toggleNode(graph: GraphModel, state: State, nodeId: string): State;

  /** The id of the node that shows a file, for the camera: the file's own card, or a card that stands for it (a route). */
  nodeFor(graph: GraphModel, fileId: string): string;

  /**
   * Make sure the card of a file exists, for the sidebar and for following edits. Returns the same
   * `state` object when the file is already visible, so the caller can tell that nothing changed.
   */
  reveal(graph: GraphModel, state: State, fileId: string): State;
}
