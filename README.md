# Vibe Review

**Watch AI-written code appear as a live diagram, and always know where to start reviewing.**

Vibe Review is a VS Code extension that runs next to a coding agent (Claude Code, Copilot, Codex, or anything else that writes files). It reads your git changes and draws them as a class-diagram-like dependency graph: files as cards, symbols inside them, arrows from the code that uses something to the code it uses. When the agent edits a file, the card lights up and the view follows it.

![Vibe Review following an agent: a new file is created, then another is edited](docs/media/demo.gif)

<sub>The animation is the real webview playing a scripted sample session (no agent was involved). It shows a file being created, the card appearing, and the view moving to the next file being edited.</sub>

> **Status: alpha.** It works end to end for TypeScript, JavaScript and Next.js projects. Python/FastAPI is planned. Expect rough edges, and please open issues.

## What you get

- **A diagram of what changed.** Changed files plus the files they use and the files that use them. A "Full system" view shows the whole workspace.
- **Where to start.** The changed files are grouped into *features* (files that import each other). Each feature has its own reading order, a "start here" mark, numbered badges and a one-line reason per file. Foundations come first.
- **Hover to see a route.** Hover a card or a symbol to light up everything it uses and everything that uses it, however many steps away. Hidden rows on the route are shown while you hover.
- **Click to read the code.** Clicking a symbol opens the file beside the graph on the first changed line, marks the symbol, the changed lines, and the exact words that depend on it. Links in the editor hover walk the route one step at a time.
- **Live.** The graph refreshes when files change on disk. A file being written shows an "editing" indicator, a file that doesn't exist in the diagram yet gets a placeholder card, and the view follows the edits (you can switch to fit-all or off, and moving the view yourself pauses it until you press *Resume follow*).
- **Big files stay readable.** Large changed files collapse to the symbols that changed; *Full view* opens everything.

### What the colors mean

| Color | Meaning |
| --- | --- |
| Purple | the symbol you opened |
| Blue | what it uses |
| Orange | what uses it |
| Green (in the editor) | lines git reports as changed |

In the editor, the light tint covers the whole symbol. The stronger line and the highlighted word show where the name is written.

## Try it

Requirements: VS Code 1.90 or newer, Node.js (20 or newer is what it's developed with), and a project that is a git repository.

```bash
git clone https://github.com/mutabalShawandar/vibe-review.git
cd vibe-review
npm install
npm run host -- "path/to/the/project/you/want/to/review"
```

`npm run host` builds the extension and opens a VS Code window with it loaded. (Pressing **F5** in this repository also works, but starting the debugger can time out on a busy machine, which is why the script exists.)

In that window:

1. Make some changes in the project (or let your agent work).
2. Run **Vibe Review: Open** from the command palette, or click `Vibe Review: N changed` in the status bar.

There is no Marketplace release yet.

## How it works

1. **Changes** come from the git working tree (`git diff` plus untracked files), so any tool that writes files works. Nothing is specific to one agent.
2. **Parsing** uses tree-sitter (WASM). Each language is a strategy in `src/languages/<language>/` that reports symbols, imports and where imported names are used. The core never mentions a language.
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

Contributions are welcome, especially new languages. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; the short version is: one folder per language, registered in one line, with tests. Commits follow [Conventional Commits](https://www.conventionalcommits.org/).

Run the checks before opening a pull request:

```bash
npm run typecheck
npm test
```

## License

[MIT](LICENSE)
