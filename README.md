# Vibe Review

**Watch AI-written code appear as a live diagram, and always know where to start reviewing.**

Vibe Review is a VS Code extension that runs next to a coding agent (Claude Code, Copilot, Codex, or anything else that writes files). It reads your git changes and draws them as a class-diagram-like dependency graph: files as cards, symbols inside them, and arrows from the code that uses something to the code it uses. When the agent edits a file, its card lights up and the view follows it. When you want to read the code, one click opens it with the change and everything it touches marked in color.

![Vibe Review following an agent: a new file is created, then another is edited](docs/media/demo.gif)

<sub>The animation is the real webview playing a scripted sample session; no agent was involved. A file is created (placeholder card), the real card replaces it, and the view moves on to the next file being edited.</sub>

> **Status: alpha.** It works end to end for TypeScript, JavaScript and Next.js projects. Python and FastAPI are planned. Expect rough edges, and please open issues.

## From the graph to the code

The graph on the left, the code on the right. The cards are the changed files with the symbols inside them. The sidebar says where to start. The editor shows the symbol you clicked, the lines git reports as changed, and what that symbol uses and is used by.

![The graph next to the editor, with the changed lines, the opened symbol and a hover card](docs/media/editor-and-graph.png)

Hovering the marked code shows what the symbol uses and what uses it. Each name is a link that jumps there and re-centers everything on it, so you can walk the route one step at a time.

| What a symbol is used by | What a symbol uses |
| --- | --- |
| ![Hover card for recordAudit: it uses insert, and is used by createUser and deleteUser](docs/media/hover-used-by.png) | ![Hover card for createUser: it uses recordAudit and insert, and nothing in the change uses it](docs/media/hover-uses.png) |

## What you get

- **A diagram of what changed.** Changed files plus the files they use and the files that use them. A *Full system* view shows the whole workspace.
- **Where to start.** The changed files are grouped into *features* (files that import each other). Each feature has its own reading order, a "start here" mark, numbered badges, and a one-line reason per file. Foundations come first.
- **Hover to see a route.** Hover a card or a symbol to light up everything it uses and everything that uses it, however many steps away. Rows that a collapsed card hides are shown while you hover.
- **Click to read the code.** Clicking a symbol opens the file beside the graph on the first changed line, with the symbol, the changed lines and the exact words that depend on it marked, each with a short label.
- **Live.** The graph refreshes when files change on disk. A file being written shows an "editing" indicator, a file that isn't in the diagram yet gets a placeholder card, and the view follows the edits. You can switch the follow to fit-all or off, and moving the view yourself pauses it until you press *Resume follow*.
- **Big files stay readable.** A large changed file shows only the symbols that changed. *Full view* opens everything.

### What the colors mean

| Color | Meaning |
| --- | --- |
| Purple | the symbol you opened |
| Blue | what it uses |
| Orange | what uses it |
| Green (in the editor) | lines git reports as changed |

In the editor the light tint covers the whole symbol; the stronger line and the highlighted word show where the name is written. The same legend is in the toolbar and in the hover card.

## Run it

There is no Marketplace release yet, so for now you run the extension from source in a VS Code development window. It takes about two minutes.

### Prerequisites

- **VS Code 1.90 or newer**, with the `code` command available in your terminal. (In VS Code: Command Palette → *Shell Command: Install 'code' command in PATH*. On Windows the installer already adds it.)
- **Node.js** (20 or newer is what it is developed with) and npm.
- **git** on your PATH.
- **A project to review**: a git repository with some uncommitted changes. Today the diagram understands TypeScript and JavaScript files (`.ts`, `.tsx`, `.js`, `.jsx`, and the `m`/`c` variants), so a Next.js or Node project is ideal.

### Quick start

```bash
git clone https://github.com/mutabalShawandar/vibe-review.git
cd vibe-review
npm install
npm run host -- "path/to/the/project/you/want/to/review"
```

`npm run host` builds the extension and opens a new VS Code window with it loaded, on the project you passed (other extensions are switched off in that window so they cannot interfere). In that window:

1. Make sure the project has uncommitted changes, or start your agent on it.
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **Vibe Review: Open**. You can also click `Vibe Review: N changed` in the status bar.
3. The graph appears beside your editor. Keep it open while the agent works.

### Using it

- **Start with the sidebar.** *Where to start* lists the changed files, grouped into features, in reading order. Read the one marked **start here** first. Click an item to center its card and open the file.
- **Hover to see connections.** Hover a card or a symbol to light up everything it uses (blue) and everything that uses it (orange), however many steps away.
- **Click to read the code.** Clicking a symbol opens its file beside the graph on the first changed line. The symbol is purple, changed lines are green, and the exact words that depend on it are marked with a short label. Hover the marked code and click a name to jump along the route.
- **Let it follow the agent.** While files are written, their cards glow with an *editing* chip, a file that is not in the diagram yet gets a placeholder card, and the view moves along. Panning or zooming yourself pauses this; **Resume follow** takes you to the file being edited, or the last one that was.
- **The toolbar.** *Changes* shows what changed and its neighbors, *Full system* shows every file. *Full view* opens every card (big changed files are collapsed to what changed). *Follow* chooses how the view follows edits: zoom to the edited file, fit all edited files, or off.

### Other ways to run it

- **From VS Code:** open this repository and press **F5** (the *Run Extension* configuration). If it complains that the extension host did not start in 10 seconds on a busy machine, use `npm run host` instead, which has no debugger attached.
- **While developing:** `npm run watch` rebuilds on every save; reload the development window (*Developer: Reload Window*) to pick up extension changes. Webview-only changes need just a close and reopen of the Vibe Review tab.
- **As an installable `.vsix`:** not available yet; it comes with the first release.

### Troubleshooting

| Problem | Likely cause |
| --- | --- |
| "No changes found" | The folder is not a git repository, nothing is uncommitted, or the changed files are not TypeScript/JavaScript. Try **Full system**. |
| `code` is not recognized | The `code` command is not on your PATH; see the prerequisites. |
| No status bar item | git is missing, or the folder is not a git repository. |
| The graph shows only part of a multi-root workspace | Only the first workspace folder is analyzed for now. |
| The first open is slow on a big project | The first scan parses every file. Later refreshes only re-parse files that changed. |
| Editor marks are one line off after you edit | They are drawn from the last scan. Click the symbol again once the graph has refreshed. |

If something else goes wrong, open the **Output** panel and pick **Vibe Review**, then [open an issue](https://github.com/mutabalShawandar/vibe-review/issues) with what you see.

## How it works

1. **Changes** come from the git working tree (`git diff` plus untracked files), so any tool that writes files works. Nothing is specific to one agent.
2. **Parsing** uses tree-sitter (WASM). Each language is a strategy in `src/languages/<language>/` that reports symbols, imports, and where imported names are used. The core never mentions a language.
3. **The graph** is built in `src/core/`: import edges, symbol-to-symbol links, which symbols are relevant, and the review order (foundations first, then the files most others import).
4. **The UI** is a React app (React Flow for drawing, elkjs for layout) in `webview/`. It only receives plain JSON, so it knows nothing about languages.

Usage detection is approximate: it matches imported names inside each symbol and does not model shadowing or dynamic access.

## Roadmap

- [x] TypeScript, JavaScript and Next.js
- [x] Live refresh, follow mode, review order, editor marks
- [ ] "Reviewed" checkmarks
- [ ] Python and FastAPI
- [ ] Optional Claude Code integration (hooks) for "files the agent is editing now" and "changes since the last prompt"
- [ ] Marketplace release

See [PLAN.md](PLAN.md) for the full design.

## Contributing

Contributions are welcome, especially new languages. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. The short version: one folder per language, registered in one line, with tests. Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

Run the checks before opening a pull request:

```bash
npm run typecheck
npm test
```

## License

[MIT](LICENSE)
