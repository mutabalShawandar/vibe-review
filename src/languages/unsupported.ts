import type { UnsupportedLanguage } from '../core/types';

// Source files in languages Vibe Review cannot read yet, by extension. Only used to tell the
// reviewer "this project has Python, and it is not in the diagram": it never decides what is
// analyzed (that is the registry's job). Data files, docs and assets are deliberately absent.
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.py': 'Python',
  '.pyi': 'Python',
  '.go': 'Go',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.rs': 'Rust',
  '.swift': 'Swift',
  '.dart': 'Dart',
  '.scala': 'Scala',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.hpp': 'C++',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.astro': 'Astro',
};

/**
 * Group files that no language strategy handles by language: how many there are, and which of
 * them changed. `files` are the workspace files without a strategy (see AnalysisResult.otherFiles),
 * `changed` the paths git reports as changed (a changed file that no longer exists still counts).
 * Languages with changes come first, then by size, so the one that matters now is on top.
 */
export function describeUnsupported(files: readonly string[], changed: readonly string[]): UnsupportedLanguage[] {
  const languageOf = (file: string) => LANGUAGE_BY_EXTENSION[file.slice(file.lastIndexOf('.')).toLowerCase()];
  const byLanguage = new Map<string, { files: Set<string>; changed: string[] }>();

  const entry = (language: string) => {
    let found = byLanguage.get(language);
    if (!found) {
      found = { files: new Set(), changed: [] };
      byLanguage.set(language, found);
    }
    return found;
  };

  for (const file of files) {
    const language = file.includes('.') ? languageOf(file) : undefined;
    if (language) {
      entry(language).files.add(file);
    }
  }
  for (const file of changed) {
    const language = file.includes('.') ? languageOf(file) : undefined;
    if (language) {
      const found = entry(language);
      found.files.add(file);
      found.changed.push(file);
    }
  }

  return [...byLanguage]
    .map(([language, { files: all, changed: touched }]) => ({
      language,
      files: all.size,
      changed: [...new Set(touched)].sort(),
    }))
    .sort((a, b) => b.changed.length - a.changed.length || b.files - a.files || a.language.localeCompare(b.language));
}
