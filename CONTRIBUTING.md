# Contributing to Vibe Review

Thanks for helping! Vibe Review is a VS Code extension that visualizes git changes as a live dependency diagram so reviewers know where to start.

## Setup
> The scaffold lands in step 1 of `PLAN.md`; these commands apply once it exists.

```bash
npm install
npm run build
npm test
```
Press **F5** in VS Code to launch the Extension Development Host, then run `Vibe Review: Open`.

## Architecture in one minute
- `src/core/` is language-agnostic. It must never import or mention a specific language.
- Every language is a **strategy** implementing `LanguageStrategy` in `src/languages/<lang>/`.
- Strategies are registered only in `src/languages/index.ts`.

See `PLAN.md` for the full design.

## Adding a language
1. Create `src/languages/<lang>/` with a `<Lang>Strategy.ts` implementing `LanguageStrategy` plus `queries/*.scm`.
2. Add test fixtures and tests for symbol extraction and import resolution.
3. Register it in `src/languages/index.ts` (one line).
4. Touching anything in `src/core/` for a language means the interface needs to change; discuss in an issue first.

## Commits
We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <summary>
```
Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`.
Scopes: `core`, `changes`, `ui`, `typescript`, `python`, or the language name.
Example: `feat(python): resolve relative imports`

## Pull requests
- Keep them small and focused; one concern per PR.
- Fill in the PR template, link an issue, and include screenshots for UI changes.
- Tests must pass.

## Conduct
See `CODE_OF_CONDUCT.md`.
