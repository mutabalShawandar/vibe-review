import { layoutGraph } from '../layout';
import type { ViewRenderer } from './ViewRenderer';

/** One card per file, laid out by who imports whom. Every file is always visible, so there is no state. */
export const filesView: ViewRenderer<undefined> = {
  kind: 'files',
  initialState: undefined,
  layout: (graph, expanded) => layoutGraph(graph, expanded),
  toggleNode: () => undefined,
  reveal: () => undefined,
};
