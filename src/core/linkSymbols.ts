import type { AnalyzedFile, ImportBinding, ResolvedImport, SymbolLink, SymbolRef } from './types';

/**
 * Work out, for one file, which symbol uses which symbol of each file it imports.
 * Pure and language-independent: the strategy already reported what each symbol references
 * and what each import brings in; this only matches the two.
 *
 *   page.tsx:  import { getUsers } from './users'     ... function UsersPage() { getUsers() }
 *   users.ts:  export function getUsers() {...}
 *   ->  link  UsersPage (page.tsx)  uses  getUsers (users.ts)
 *
 * @returns the links for every import that points at an analyzed file, keyed by that file
 */
export function linkImports(file: AnalyzedFile, byPath: Map<string, AnalyzedFile>): Map<string, SymbolLink[]> {
  const linksByTarget = new Map<string, SymbolLink[]>();

  for (const imported of file.imports) {
    const target = byPath.get(imported.file);
    if (!target) {
      continue;
    }
    const links = dedupe(linksFor(file, imported, target));
    // An arrow always says something; with nothing more specific it is a plain file-level link.
    linksByTarget.set(imported.file, links.length > 0 ? links : [{}]);
  }
  return linksByTarget;
}

function linksFor(file: AnalyzedFile, imported: ResolvedImport, target: AnalyzedFile): SymbolLink[] {
  const links: SymbolLink[] = [];

  for (const binding of imported.bindings) {
    if (binding.reexport) {
      continue; // passes a name along; it does not use it
    }
    const to = targetSymbol(target, binding);
    const users = binding.local === '' ? [] : symbolsUsing(file, binding.local);

    if (users.length === 0) {
      links.push({ ...(to ? { to } : {}) }); // imported but not used inside any symbol
    }
    for (const { ref: from, lines } of users) {
      links.push({ from, ...(to ? { to } : {}), ...(lines ? { lines, name: binding.local } : {}) });
    }
  }
  return links;
}

/** The symbol of `target` that a binding refers to, or undefined when it is the module as a whole. */
function targetSymbol(target: AnalyzedFile, binding: ImportBinding): SymbolRef | undefined {
  if (binding.imported === '*') {
    return undefined; // `import * as db`: any of the module's symbols could be meant
  }
  const symbol =
    binding.imported === 'default'
      ? target.symbols.find((candidate) => candidate.isDefault)
      : target.symbols.find((candidate) => candidate.name === binding.imported);
  return symbol ? { symbol: symbol.name } : undefined;
}

/** Symbols and class members of `file` whose body mentions the imported name `local`, with the lines it is mentioned on. */
function symbolsUsing(file: AnalyzedFile, local: string): { ref: SymbolRef; lines?: number[] }[] {
  const users: { ref: SymbolRef; lines?: number[] }[] = [];
  for (const symbol of file.symbols) {
    const usingMembers = (symbol.members ?? []).filter((member) => member.references?.includes(local));
    for (const member of usingMembers) {
      users.push({ ref: { symbol: symbol.name, member: member.name }, lines: member.referenceLines?.[local] });
    }
    // The class itself (e.g. `extends Base`) only counts when no member explains the use.
    if (symbol.references?.includes(local) && usingMembers.length === 0) {
      users.push({ ref: { symbol: symbol.name }, lines: symbol.referenceLines?.[local] });
    }
  }
  return users;
}

function dedupe(links: SymbolLink[]): SymbolLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = JSON.stringify(link);
    return seen.has(key) ? false : (seen.add(key), true);
  });
}
