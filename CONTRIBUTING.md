# Contributing to Vibe Review

Thanks for helping! Vibe Review is a VS Code extension that draws your git changes as a live dependency diagram, so a reviewer of AI-written code knows where to start. This guide gets you from a fresh clone to a pull request.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first. For bugs and ideas, open an issue using one of the templates. For anything bigger than a small fix, open an issue **before** writing code, so we can agree on the approach.

## Setup

You need VS Code 1.90 or newer, Node.js 22 or newer, git, and the `code` command on your PATH (in VS Code: *Command Palette → Shell Command: Install 'code' command in PATH*; on Windows the installer adds it).

First **fork** the repository (the *Fork* button at the top right of the GitHub page), then clone **your fork**. You cannot push to the main repository, so work always goes through a fork:

```bash
git clone https://github.com/<your-username>/vibe-review.git
cd vibe-review
git remote add upstream https://github.com/mutabalShawandar/vibe-review.git   # to pull in new changes later
npm install
npm test            # unit tests (vitest)
npm run typecheck   # extension host and webview
```

### Running the extension

```bash
npm run host -- "path/to/a/project/with/uncommitted/changes"
```

This builds the extension and opens a second VS Code window, with the extension loaded, on the project you pass. Other extensions are disabled in it so they can't interfere. In that window run **Vibe Review: Open** from the Command Palette. The project must be a git repository with some uncommitted changes (edit a file, or let an agent work), otherwise the diagram is empty.

Alternatively press **F5** in this repository (the "Run Extension" launch configuration). On a busy machine VS Code can give up waiting for the debugger ("extension host did not start in 10 seconds"); `npm run host` has no debugger and avoids that.

`npm run watch` rebuilds on every save. After a rebuild, reload the development window (*Developer: Reload Window*) to load the new extension code; if you only changed the webview (`webview/`), closing and reopening the Vibe Review tab is enough.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm run host -- "<project>"` | Build, then open a development window on a project |
| `npm run build` | Build the extension (`dist/extension.js`), the webview (`dist/webview/`) and copy the tree-sitter grammars |
| `npm run watch` | Rebuild on change |
| `npm test` | Run all tests |
| `npm run typecheck` | Type-check the extension and the webview |

The three debug commands (*Log Changes*, *Analyze Active File*, *Build Graph*) are hidden from the Command Palette. To see them while developing, turn on the setting `vibeReview.debugCommands` in the development window.

## How the code is organized

```
src/
  core/          Language-agnostic. Types, the strategy interface, the registry, the graph builder.
  changes/       Reads git's view of the changes (git diff, untracked files).
  languages/     One folder per language, registered in languages/index.ts.
  frameworks/    One folder per framework (Next.js...), registered in frameworks/index.ts.
  parser/        Loads tree-sitter grammars (WASM).
  workspace/     Scans the workspace, caches analysis, watches for file changes.
  ui/            The VS Code side of the panel: webview host, messages, status bar, editor marks.
  extension.ts   Activation and commands.
webview/src/     The React app (React Flow for drawing, elkjs for layout). Knows nothing about languages.
test/            Unit tests with fixtures in test/fixtures/<language>/.
```

Two rules keep this maintainable:

- **`src/core/` never mentions a language or a framework.** If a feature seems to need that, the strategy interface needs to change; discuss it in an issue first.
- **The webview only receives plain JSON** (`GraphModel` in `src/core/types.ts`) and sends small messages back (`src/ui/messages.ts`). It never reads files or runs git.

`PLAN.md` has the original design notes and the decisions behind it.

## Adding a language

This is the contribution we want most. A language is one folder plus one line.

1. **Create `src/languages/<lang>/<Lang>Strategy.ts`** implementing `LanguageStrategy` (read the comments in [`src/core/LanguageStrategy.ts`](src/core/LanguageStrategy.ts); they describe each method with examples):
   - `id` and `extensions`: the language id (e.g. `python`) and the lowercase file extensions it owns (each extension belongs to one strategy).
   - `grammarFor(path)`: the tree-sitter grammar file for a file, e.g. `tree-sitter-python.wasm`.
   - `extract(file)`: read the parsed tree and return the **symbols** (functions, classes, methods, types... with their 1-based line ranges) and the **imports** as written.
   - `resolveImport(specifier, fromFile, ctx)`: turn an import string into a workspace file path, or `undefined` for external packages. Use `ctx` for file access; do not use `fs` directly.
   - `entryPoint?(path)`: optional label for notable files (a route, a controller, a page).
2. **Report more than the minimum, if you can.** The richer diagram needs, per import, the names it brings in (`ImportRef.bindings`), and per symbol, which of those names it uses and on which lines (`SymbolInfo.references`, `referenceLines`). Without them a file still appears with arrows, but only at file level. The TypeScript strategy (`src/languages/typescript/`) is the reference implementation: queries live in `queries/*.scm`, import resolution in `resolveImport.ts`.
3. **Ship the grammar.** Add the grammar's file name to `GRAMMARS` in [`esbuild.mjs`](esbuild.mjs). The grammars come from the `tree-sitter-wasms` package; if yours isn't in it, open an issue.
4. **Register it** with one line in [`src/languages/index.ts`](src/languages/index.ts).
5. **Test it.** Put fixture files in `test/fixtures/<lang>/` and write tests like `test/TypeScriptStrategy.test.ts` and `test/resolveImport.test.ts`: symbols with their lines, imports with their bindings, and import resolution.
6. **Try it for real** with `npm run host` on a project in that language, and include a screenshot in the pull request.

## Adding a framework

A framework is not a language: Next.js and Express are both TypeScript, and one workspace can hold several projects. So frameworks are a separate strategy that only labels files; the language strategy still does the parsing. Like a language, it is one folder plus one line.

1. **Create `src/frameworks/<name>/<Name>Strategy.ts`** implementing `FrameworkStrategy` (see [`src/core/FrameworkStrategy.ts`](src/core/FrameworkStrategy.ts)):
   - `id`: e.g. `nextjs`.
   - `detect(ctx, files)`: return the project folders that use the framework, `""` for the workspace root. `files` is every file git knows, so no directory walk is needed; read config files such as `package.json` or `pyproject.toml` through `ctx.readFile`. Return `[]` when the framework is not used.
   - `entryPoint(path)`: the label for a notable file, or `undefined` for an ordinary one. `path` is relative to the project folder `detect` returned, so the rules work wherever the project lives.
   - `role?(path)`: optional. What a labeled file is for, in the shared words `page`, `layout`, `api`, `boundary`, `middleware` or `config` (`FileRole` in [`src/core/types.ts`](src/core/types.ts)). The diagram colors by role, so a Next.js layout and a FastAPI router get the same color. Give every label `entryPoint` can return a role; `test/frameworks.test.ts` checks that for Next.js.
   - `route?(path)`: optional, for frameworks that turn files into URLs. The URL path a labeled file belongs to, with dynamic parts written as the framework writes them (`/users/[id]`). Files of one route (a page and its layout) return the same string. It feeds the Routes view; see `NextJsStrategy` for how groups, slots and private folders are handled.
2. **Register it** with one line in [`src/frameworks/index.ts`](src/frameworks/index.ts).
3. **Test it** like `test/frameworks.test.ts`: detection (root, monorepo, invalid config) and the label of each kind of file, including files that must stay unlabeled.
4. **Try it for real** with `npm run host` on a project that uses the framework.

If several frameworks are detected, a file is judged by the deepest project folder that contains it; within one folder, the first registered framework with a label for the file wins.

## Adding a view

A view is one way of drawing the graph: Changes shows one card per file, Full System puts files in folder boxes. The app asks the active view where everything goes and never looks at what a node stands for.

1. **Create `webview/src/views/<name>View.ts`** implementing `ViewRenderer` (see [`webview/src/views/ViewRenderer.ts`](webview/src/views/ViewRenderer.ts)):
   - `kind` and `label`: the id, and the name in the *View* menu. `isAvailable(graph)` says when the view can show a graph at all (Routes needs files with a route), and `viewsFor` lists the available ones.
   - `initialState`: what the view remembers about the reader's choices (open folders, folded branches) before they change anything.
   - `layout(graph, expanded, state)`: the nodes with positions and the arrows between them.
   - `toggleNode(graph, state, nodeId)`: a click on a node that stands for several files; return the new state.
   - `nodeFor(graph, fileId)`: the id of the node that shows a file, for the camera. A file's own card, or the card that stands for it (a route).
   - `reveal(graph, state, fileId)`: make a file's card exist (the sidebar and the follow mode need it); return the same `state` object if it is visible already.
   Keep it to pure functions with no React, so every transition is unit tested.
2. **Draw its nodes.** Every node `type` the view emits needs a component in [`webview/src/views/nodeTypes.ts`](webview/src/views/nodeTypes.ts).
3. **Register it** with one line in [`webview/src/views/index.ts`](webview/src/views/index.ts), and choose when it is used in `viewKindFor`.
4. **Test it** like `test/views.test.ts`: the layout, each state transition, and that nothing changes when nothing should.
5. **Look at it** on a real project (`npm run host`), in a light and a dark theme.

## Working on the webview

The graph, sidebar and cards live in `webview/src/`. Pure logic (folder boxes in `groups.ts`, routes, what's fresh, card rows) is in plain `.ts` files and is unit-tested (`test/groups.test.ts`, `test/layout.test.ts`, `test/route.test.ts`, `test/review.test.ts`, `test/card.test.ts`...). Keep it that way: logic in a testable function, rendering in the component. Colors come from VS Code theme variables (`--vscode-*`) so every theme works; check your change in a light and a dark theme.

## Picking an issue

Issues labeled [good first issue](https://github.com/mutabalShawandar/vibe-review/labels/good%20first%20issue) are small and well described; [help wanted](https://github.com/mutabalShawandar/vibe-review/labels/help%20wanted) ones are bigger.

1. **Ask first.** Comment "I'd like to work on this" on the issue and **wait until the maintainer assigns it to you** before you start. This keeps two people from doing the same work.
2. **One person per issue.** Good first issues have a single assignee, so more newcomers get a chance.
3. **Assignments last 14 days.** If there is no pull request, draft or update by then, the issue goes back to the pool and anyone may ask for it. If you need more time, say so in the issue and keep it.
4. **Small fixes need no assignment.** For a typo, a broken link or a one-line fix, open the pull request directly.
5. **Anything bigger than a small fix needs an issue first**, so we can agree on the approach before you invest time. Open one if none exists.

## Making a change

1. **Fork and clone** as described in *Setup*. Never work on `main` of your fork; make a branch for each change.
2. **Create a branch** from an up-to-date `main`: `git switch -c feat/nextjs-entry-points` (a short name that says what it does).
3. **Make the change**, with tests, and run `npm run typecheck` and `npm test`.
4. **Commit** using the conventions below, then **push the branch to your fork**: `git push -u origin feat/nextjs-entry-points`.
5. **Open a pull request** from your branch to `main` of the main repository (GitHub offers a button right after you push). Fill in the template.
6. **Respond to review** by pushing more commits to the same branch; the pull request updates by itself.

To pick up changes made upstream while you work: `git fetch upstream` and then `git rebase upstream/main` (or merge it) on your branch.

New to open source? Pick a *good first issue* as described above. Questions are welcome in the issue.

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <summary>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`.
Scopes: `core`, `changes`, `ui`, `typescript`, `python`, or the language name.
Example: `feat(python): resolve relative imports`

## Pull requests

- Keep them small and focused; one concern per pull request.
- Fill in the pull request template, link the issue, and include screenshots (or a short recording) for any change to the diagram or the editor marks.
- `npm test` and `npm run typecheck` must pass; CI runs both.
- Update the docs (README, this file) and add a line to [`CHANGELOG.md`](CHANGELOG.md) when behavior changes.

## License

The project is under the [Apache License 2.0](LICENSE). As Section 5 of that license says, a contribution you submit is licensed under the same terms (including the patent grant), unless you state otherwise. Please only submit work you have the right to contribute.

## Conduct

See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Security problems: see [`SECURITY.md`](SECURITY.md).
