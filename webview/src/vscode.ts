import type { WebviewMessage } from '../../src/ui/messages';

// Provided by VS Code inside the webview. It may be requested only once per page.
declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };

export const vscode = acquireVsCodeApi();
