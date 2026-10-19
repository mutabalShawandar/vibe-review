import type { GraphModel, GraphScope } from '../core/types';

// The messages the extension and the webview send each other. Both sides import this
// file, so TypeScript catches a message that one side sends and the other does not expect.

/** Extension -> webview. */
export type HostMessage =
  | { type: 'loading'; message: string }
  | { type: 'graph'; graph: GraphModel }
  | { type: 'error'; message: string };

/** Webview -> extension. */
export type WebviewMessage =
  | { type: 'ready' } // the page has loaded and can receive a graph
  | { type: 'setScope'; scope: GraphScope };
