# Vibe Review — VS Code extension plan

## Context
AI-generated ("vibe coded") changes land fast and reviewers don't know where to start. The extension shows the current git changes as a live dependency diagram (files, with their classes/interfaces/functions inside), highlights what changed, what depends on it, and suggests a review order. Empty project, built from scratch.

## Vision
The ultimate goal: an extension that runs next to Claude Code (or any coding agent) and makes vibe coding a **visual process**. While an agent edits the project, the reviewer watches the change appear as a live class-diagram-like graph and always knows where to start reviewing.

What this means for the design:
- **Agent-agnostic by construction.** Changes come from the git working tree, so any tool that writes files works. Agent-specific features are optional layers on top, never required.
- **Live is the point.** Step 8 (live refresh) is core, not polish: the graph must update as files change, without losing the reviewer's place (selected card, "reviewed" marks, zoom).
- **Ideas for after v1, not committed to:** highlight the files the agent is touching right now; show only "changes since the last prompt" (a checkpoint baseline instead of HEAD); an integration with Claude Code (hooks or its IDE connection) to learn which files were edited; sending a review comment on a symbol back to the agent as a prompt.

## Working rule
You stay in the picture: every step below is small, runnable, and approved by you before the next one starts.

## Decisions (confirmed)
- Changes = git working tree vs HEAD (+ untracked), refreshed on file save/change.
- Graph = file nodes, import edges; symbols listed inside nodes, changed ones highlighted (via diff hunk line ranges).
- Parsing = tree-sitter (WASM, `web-tree-sitter`) for every language; per-language grammar + `.scm` query files.
- v1 stacks: TypeScript/Next.js and Python/FastAPI. New stacks must be a drop-in.

## Architecture (Strategy pattern)
One interface, one folder per language; core never mentions a language.

```
src/
  core/
    types.ts             FileAnalysis, SymbolInfo, GraphModel, ChangeSet
    LanguageStrategy.ts  interface: id, extensions, grammarWasm,
                         extract(tree, source) -> {symbols, imports}
                         resolveImport(spec, fromFile, ctx) -> file | undefined
                         isEntryPoint?(file) -> hint (Next page/route, FastAPI router)
    StrategyRegistry.ts  register/lookup by extension
    GraphBuilder.ts      files -> nodes/edges, marks changed/dependent/dependency, review order
  changes/
    GitChangeProvider.ts `git diff -U0 --relative HEAD` + untracked -> ChangeSet (file -> line ranges)
  languages/
    typescript/          TypeScriptStrategy.ts, queries/*.scm, tsconfig path-alias resolution
    python/              PythonStrategy.ts, queries/*.scm, package/relative import resolution
    index.ts             the ONLY place strategies are registered
  ui/
    ReviewPanel.ts       webview host, debounced refresh, open-file messages
  extension.ts           activate, command `vibeReview.open`, file watcher wiring
webview/                 React app (React Flow + elkjs); consumes GraphModel JSON only, knows nothing about languages
test/                    per-strategy fixtures + GraphBuilder tests
```
Adding a stack = new folder in `languages/` + one line in `languages/index.ts`. Nothing else changes.

## Open-source contribution setup
Project is open source, so contributor conventions exist from day one:
- `CONTRIBUTING.md`: setup, F5 debugging, tests, and a "how to add a language" pointer.
- `.github/PULL_REQUEST_TEMPLATE.md`: summary, linked issue, type of change, how it was tested, screenshots of the diagram if UI changed, checklist (tests, docs, no language-specific code in `core/`).
- `.github/ISSUE_TEMPLATE/`: `bug_report.md`, `feature_request.md`, `new_language_support.md`.
- Commit convention: Conventional Commits (`feat(python): ...`, `fix(core): ...`), documented in CONTRIBUTING.md; enforced by commitlint + husky (added in step 0b, optional to turn on).
- `CODE_OF_CONDUCT.md` (Contributor Covenant), `LICENSE` (MIT, confirmed), `.editorconfig`, `.gitignore`, `CHANGELOG.md`.
- CI (`.github/workflows/ci.yml`): lint, typecheck, test on PRs.

## Incremental steps
0. **Repo hygiene** (before any code): `git init`, LICENSE, .gitignore, .editorconfig, CONTRIBUTING, PR/issue templates, commit convention doc, CODE_OF_CONDUCT. *Check: you read the templates and adjust wording.*
   - 0b (later, after scaffold): commitlint/husky and CI workflow, since they need package.json.
1. **Scaffold**: package.json, tsconfig, esbuild bundling, F5 launch config, `Vibe Review: Open` command showing an empty panel. *Check: panel opens.*
2. **Core types + Strategy interface + registry** (no logic). *Check: review the interface together — the key design point.*
3. **GitChangeProvider**, output to an output channel. *Check: edit a file, see it listed with line ranges.*
4. **Tree-sitter loader + TypeScript strategy**: symbols and imports for one file, logged. *Check: run on a real Next.js file.*
5. **TS import resolution** (relative, tsconfig `paths`/`@/`, index files).
6. **GraphBuilder** over the TS strategy: nodes/edges/status/review order as JSON. Unit tests.
7. **Webview graph** (React Flow + elkjs), in small sub-steps:
   - 7a. Webview app scaffold (React + `@xyflow/react`, bundled locally with esbuild, no CDN). *Done.*
   - 7b. Auto layout with `elkjs` (left-to-right: dependencies left, dependents right). *Done.*
   - 7c. **Richer extraction, so cards can look like a class diagram** (core + strategy, no UI yet):
     - 7c-1. Members and kinds: `SymbolInfo.members` (methods and properties of classes, members of interfaces), new kinds `method`, `property`, `component` (PascalCase function or arrow that returns JSX) and `hook` (`useX`).
     - 7c-2. Import bindings: each import records which names it brings in (named, default, namespace, type-only), not just the module.
     - 7c-3. Usage inside files: for each top-level symbol, which imported names it references. The strategy reports raw references; core matches them against the bindings, so the matching logic is language-independent.
     - 7c-4. GraphBuilder produces symbol-to-symbol links (`GraphEdge.uses: { fromSymbol, toSymbol }[]`) and applies relevance: changed files list all their symbols (changed ones flagged), connected files list only the symbols used by or from the change.
   - 7d. **Class-diagram cards** (webview): header with file name and folder, compartments by kind (classes with methods and properties, components, hooks, functions, types), changed symbols highlighted, a connection point per symbol so arrows run from the exact symbol that uses something to the exact symbol it uses. Card height computed for elkjs.
   - 7e. **Where to start**: review-order sidebar (one-line reason per file), number badges and a "start here" mark on the graph, "reviewed" checkmarks, click a file or symbol to open it at that line. Connected (dependent/dependency) files drawn dimmer.
   - 7f. Interaction: hover highlights a chain of arrows and dims the rest, filters by status, minimap, collapsible folder groups in the full-system view, scope toggle polish.
8. **Live refresh**: file watcher + debounce + analysis cache (by mtime).
9. **Python strategy** (imports, relative imports, classes/functions, FastAPI router hints). Proves the pattern with a second stack.
10. **Polish/docs**: "how to add a language" guide, README, packaging with vsce.

## Two views: changes and full system
The diagram has a toggle between two scopes (`GraphScope` in `core/types.ts`):
- **changes** (default): changed files + direct dependents/dependencies.
- **full**: every analyzed file in the workspace, with changed files highlighted and untouched ones as `unchanged`.

`GraphBuilder.build(changes, scope)` produces either model from the same cached analysis, so toggling is cheap and the logic stays in core (testable), not in the webview. The webview sends a `setScope` message; the host rebuilds and replies. Implemented in step 6 (builder) and 7d (toggle). The full scope needs a workspace scan, so it relies on the step 8 analysis cache and excludes `node_modules`, build output and anything in `.gitignore`.

**Large graphs:** in the full view, files are grouped by folder (collapsible groups, collapsed by default beyond a size threshold). Grouping is derived from the node `id` path in the webview, and elkjs supports hierarchical layout, so no extra data is needed in `GraphModel`. Done in step 7.

## Class-diagram view (decided)
Arrows are **symbol to symbol**: an arrow starts at the function/class/component that uses something and ends at the symbol it uses in the other file. Cards are **relevance-based**: changed files show everything they declare; connected files show only the symbols involved in the link to the change. Usage is detected by scanning the identifiers inside each symbol for imported names (approximate: it does not model shadowing or dynamic access, and it will be documented as such). Strategies stay language-specific only where they must be (reading the syntax tree); linking and filtering live in core.

## Review-order heuristic (step 6)
Changed files ordered dependencies-first (understand foundations before consumers), ties broken by number of dependents (largest blast radius first); strategy entry-point hints surface routes/pages.

## Verification
- Unit tests (vitest) per strategy with fixture files, and for GraphBuilder.
- Manual: F5 Extension Development Host on a sample Next.js app and a FastAPI app; edit files, confirm graph updates within ~1s and highlights correct nodes/symbols.

## Graph rendering decision
React Flow renders custom card nodes (file + symbols inside) and gives zoom/pan/minimap/selection for free. Layout is done by `elkjs` (chosen over dagre for better results on larger graphs; may run in a web worker if slow). The webview only receives plain `GraphModel` JSON from the extension host, so the UI library can be swapped without touching any language code.

## Risks to watch
- elkjs and React add bundle size to the webview (not the extension host); keep the webview a separate esbuild entry.
- WASM grammar bundling in a VS Code extension (tackled early in step 4, isolated).
- Large repos: scope analysis to changed files + 1 hop, cache parses.
