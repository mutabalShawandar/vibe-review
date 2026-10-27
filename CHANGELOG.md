# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/), and the project uses [Semantic Versioning](https://semver.org/) once it reaches a first release.

## Unreleased

Changes are listed under the day they landed, newest first. There is no tagged release yet.

### 2026-10-27

#### Added
- Frameworks are a second strategy next to languages (`FrameworkStrategy`, registered in `src/frameworks/index.ts`). A framework finds the project folders that use it (so monorepos work) and labels notable files. Next.js is the first one: App Router files (page, layout, route handler, loading, error, not-found, template, default), Pages Router files (page, API route, `_app`, `_document`), middleware/proxy/instrumentation and `next.config` get a chip on their card.
- Full System groups files into folder boxes, one per parent folder (`web/components` and `admin/components` stay separate; a label gets enough of the path to tell same-named folders apart). A folder with a changed file is open as a frame around its file cards; the others are collapsed into one small card with the file count and the number of changed files. Click a box to open or close it. Arrows that reach a collapsed folder end at its card, and arrows between the same two ends are merged, so the overview shows a few dozen arrows instead of one per symbol link. The Changes view is not grouped. Picking a file in the sidebar opens its folder first.

#### Changed
- The layout uses ELK's network-simplex layering and placement, which cut the height of a 74-file Full System diagram by about 30%.

#### Fixed
- CI failed at `npm run typecheck` because three files left over from an abandoned branch (`webview/src/folders.ts`, `webview/src/FolderOverview.tsx`, `test/folders.test.ts`) were committed. They are removed.

### 2026-10-19 to 2026-10-23: first alpha

TypeScript, JavaScript and Next.js projects.

#### Added
- A diagram of the git working tree: one card per changed file with its symbols (classes with members, components, hooks, functions, types), and arrows from the symbol that uses something to the symbol it uses. A "Full system" view shows the whole workspace.
- Where to start: changed files are grouped into features (files that import each other), each with its own reading order, a "start here" mark, numbered badges, and a reason per file.
- Hover a card or symbol to light up everything it uses and is used by, with the rows on the route marked.
- Click a symbol to open it beside the graph on its first changed line, with the symbol, the changed lines and the exact words that depend on it marked in color; links in the editor hover walk the route.
- Live refresh when files change, a status bar item (`Vibe Review: N changed`), an "editing" indicator, placeholder cards for files that are being created, and a follow mode for the view (with *Resume follow*).
- Large changed files collapse to what changed; *Full view* opens everything.
- Cards stand out from the canvas; the colors follow the VS Code theme.
- `npm run install:vscode` builds a `.vsix` and installs it into your normal VS Code, and the README has an install and quick start guide.
- A `Ctrl+Shift+B` task that opens the development window without a debugger (avoids the F5 "extension host did not start in 10 seconds" error).


#### Changed
- Bigger text and cards, higher contrast for secondary text, thicker arrows and larger connection points, so the diagram is easier to read.
