import type { GraphModel, GraphScope } from '../core/types';

// The messages the extension and the webview send each other. Both sides import this
// file, so TypeScript catches a message that one side sends and the other does not expect.

/** Extension -> webview. */
export type HostMessage =
  | { type: 'loading'; message: string }
  | { type: 'graph'; graph: GraphModel }
  | { type: 'error'; message: string }
  // Walk the route: show this symbol (or file) in the editor, as if it had been clicked in the graph.
  | { type: 'navigate'; file: string; key?: string; line?: number };

/** Webview -> extension. */
export type WebviewMessage =
  | { type: 'ready' } // the page has loaded and can receive a graph
  | { type: 'setScope'; scope: GraphScope }
  // Show a symbol in the editor and mark its route in the code: `file` at `line`..`endLine` (1-based,
  // workspace-relative path), and the symbols connected to it as `highlights`.
  | {
      type: 'open';
      file: string;
      line: number;
      endLine?: number;
      /** Where to put the cursor, when not at the start of the symbol (e.g. the line that uses a name). */
      focusLine?: number;
      origin: string;
      highlights: CodeHighlight[];
      sites: CodeSite[];
    };

/** One line of code that depends on a symbol: the exact place an imported name is written. */
export interface CodeSite {
  file: string;
  line: number;
  /** The word written there (the imported name), marked on its own inside the line. Empty when unknown. */
  name: string;
  /** `uses`: the opened symbol (or something it relies on) writes the name here. `usedBy`: something that relies on the opened symbol does. */
  role: 'uses' | 'usedBy';
}

/** A symbol elsewhere in the code that is connected to the opened one. */
export interface CodeHighlight {
  file: string;
  /** The row key of the symbol (`UserService.find`), to navigate to it. */
  key: string;
  startLine: number;
  endLine: number;
  /** `uses`: the opened symbol uses it. `usedBy`: it uses the opened symbol. */
  role: 'uses' | 'usedBy';
  /** One arrow away from the opened symbol (these files are opened in tabs; the others are only marked if already open). */
  direct: boolean;
}
