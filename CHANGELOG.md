# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/), and the project uses [Semantic Versioning](https://semver.org/) once it reaches a first release.

## Unreleased

First alpha. TypeScript, JavaScript and Next.js projects.

### Added
- A diagram of the git working tree: one card per changed file with its symbols (classes with members, components, hooks, functions, types), and arrows from the symbol that uses something to the symbol it uses. A "Full system" view shows the whole workspace.
- Where to start: changed files are grouped into features (files that import each other), each with its own reading order, a "start here" mark, numbered badges, and a reason per file.
- Hover a card or symbol to light up everything it uses and is used by, with the rows on the route marked.
- Click a symbol to open it beside the graph on its first changed line, with the symbol, the changed lines and the exact words that depend on it marked in color; links in the editor hover walk the route.
- Live refresh when files change, a status bar item (`Vibe Review: N changed`), an "editing" indicator, placeholder cards for files that are being created, and a follow mode for the view (with *Resume follow*).
- Large changed files collapse to what changed; *Full view* opens everything.
- Cards stand out from the canvas; the colors follow the VS Code theme.
