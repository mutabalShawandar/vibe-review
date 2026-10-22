# Contributing to Vibe Review

Thanks for helping! Vibe Review is a VS Code extension that draws your git changes as a live dependency diagram, so a reviewer of AI-written code knows where to start. This guide gets you from a fresh clone to a pull request.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) first. For bugs and ideas, open an issue using one of the templates. For anything bigger than a small fix, open an issue **before** writing code, so we can agree on the approach.

## Setup

You need VS Code 1.90 or newer, Node.js (20 or newer is what the project is developed with), git, and the `code` command on your PATH (in VS Code: *Command Palette → Shell Command: Install 'code' command in PATH*; on Windows the installer adds it).

```bash
git clone https://github.com/mutabalShawandar/vibe-review.git
cd vibe-review
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

## How the code is organized

```
src/
  core/          Language-agnostic. Types, the strategy interface, the registry, the graph builder.
  changes/       Reads git's view of the changes (git diff, untracked files).
  languages/     One folder per language, registered in languages/index.ts.
  parser/        Loads tree-sitter grammars (WASM).
  workspace/     Scans the workspace, caches analysis, watches for file changes.
  ui/            The VS Code side of the panel: webview host, messages, status bar, editor marks.
  extension.ts   Activation and commands.
webview/src/     The React app (React Flow for drawing, elkjs for layout). Knows nothing about languages.
test/            Unit tests with fixtures in test/fixtures/<language>/.
```

Two rules keep this maintainable:

- **`src/core/` never mentions a language.** If a feature seems to need that, the strategy interface needs to change; discuss it in an issue first.
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

## Working on the webview

The graph, sidebar and cards live in `webview/src/`. Pure logic (grouping, routes, what's fresh, card rows) is in plain `.ts` files and is unit-tested (`test/route.test.ts`, `test/review.test.ts`, `test/card.test.ts`...). Keep it that way: logic in a testable function, rendering in the component. Colors come from VS Code theme variables (`--vscode-*`) so every theme works; check your change in a light and a dark theme.

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

## Conduct

See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md). Security problems: see [`SECURITY.md`](SECURITY.md).
