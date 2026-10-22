import { linkImports } from './linkSymbols';
import type {
  AnalyzedFile,
  ChangeSet,
  GraphEdge,
  GraphModel,
  GraphNode,
  GraphScope,
  GraphSymbol,
  LineRange,
  NodeStatus,
  SymbolInfo,
  SymbolLink,
  SymbolRef,
} from './types';

/**
 * Combines "what is in the workspace" with "what changed in git" into the diagram data.
 * Pure function: no filesystem, no git, no VS Code, so every rule below is unit tested.
 *
 * Limitation: deleted files are not shown. They no longer exist, so their importers
 * cannot resolve them and there is nothing to analyze.
 */
export function buildGraph(files: AnalyzedFile[], changes: ChangeSet, scope: GraphScope): GraphModel {
  const byPath = new Map(files.map((file) => [file.path, file]));

  // Line ranges git touched, only for files we analyzed. Deleted files are skipped (see above).
  const changedRanges = new Map<string, LineRange[]>();
  for (const change of changes) {
    if (change.kind !== 'deleted' && byPath.has(change.path)) {
      changedRanges.set(change.path, change.ranges);
    }
  }

  // Arrows between files: `from` imports `to`. Imports of files we did not analyze are dropped.
  const importedBy = new Map<string, Set<string>>();
  for (const file of files) {
    for (const { file: target } of file.imports) {
      if (target !== file.path && byPath.has(target)) {
        let importers = importedBy.get(target);
        if (!importers) {
          importers = new Set();
          importedBy.set(target, importers);
        }
        importers.add(file.path);
      }
    }
  }

  const statusOf = (file: AnalyzedFile): NodeStatus => {
    if (changedRanges.has(file.path)) {
      return 'changed';
    }
    // Checked before "dependency": a file that imports a change can break because of it,
    // which matters more to a reviewer than a file that only provides context.
    if (file.imports.some((imported) => changedRanges.has(imported.file))) {
      return 'dependent';
    }
    if ([...(importedBy.get(file.path) ?? [])].some((importer) => changedRanges.has(importer))) {
      return 'dependency';
    }
    return 'unchanged';
  };

  // What exactly each arrow means: which symbol of the importing file uses which symbol of the other.
  const linksByEdge = new Map<string, SymbolLink[]>();
  for (const file of files) {
    for (const [target, links] of linkImports(file, byPath)) {
      linksByEdge.set(edgeKey(file.path, target), links);
    }
  }
  const relevantSymbols = relevantSymbolKeys(linksByEdge, changedRanges);

  const nodes: GraphNode[] = [];
  for (const file of files) {
    const status = statusOf(file);
    if (scope === 'changes' && status === 'unchanged') {
      continue; // the "changes" view only shows files connected to a change
    }
    nodes.push({
      id: file.path,
      language: file.language,
      status,
      symbols: toGraphSymbols(
        file.symbols,
        changedRanges.get(file.path),
        // A changed file lists everything it declares; others only what takes part in a link to a change.
        status === 'changed' ? 'all' : (relevantSymbols.get(file.path) ?? new Set()),
      ),
      ...(file.entryPoint ? { entryPoint: file.entryPoint } : {}),
    });
  }
  nodes.sort((a, b) => a.id.localeCompare(b.id));

  // Only arrows whose two ends are both on screen.
  const shown = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = [];
  for (const file of files) {
    for (const { file: target } of file.imports) {
      if (target !== file.path && shown.has(file.path) && shown.has(target)) {
        edges.push({ from: file.path, to: target, uses: linksByEdge.get(edgeKey(file.path, target)) ?? [{}] });
      }
    }
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const changed = nodes.filter((node) => node.status === 'changed').map((node) => node.id);
  return { scope, nodes, edges, reviewOrder: orderForReview(changed, byPath, importedBy) };
}

const edgeKey = (from: string, to: string) => `${from}\0${to}`;

/** Key of a symbol (`UserService`) or one of its members (`UserService.find`) in the relevance sets. */
const symbolKey = (ref: SymbolRef) => (ref.member ? `${ref.symbol}.${ref.member}` : ref.symbol);

/**
 * For files that are not themselves changed: the symbols worth showing, i.e. the ones on either
 * end of a link to or from a changed file. Symbols that only talk to other unchanged files are left out.
 * A member being relevant makes its class relevant too, so the card can show where it sits.
 */
function relevantSymbolKeys(
  linksByEdge: Map<string, SymbolLink[]>,
  changedRanges: Map<string, LineRange[]>,
): Map<string, Set<string>> {
  const relevant = new Map<string, Set<string>>();
  const add = (file: string, ref: SymbolRef | undefined) => {
    if (!ref) {
      return;
    }
    const keys = relevant.get(file) ?? new Set<string>();
    keys.add(ref.symbol);
    keys.add(symbolKey(ref));
    relevant.set(file, keys);
  };

  for (const [key, links] of linksByEdge) {
    const [from, to] = key.split('\0');
    if (!changedRanges.has(from) && !changedRanges.has(to)) {
      continue; // an arrow between two untouched files
    }
    for (const link of links) {
      add(from, link.from);
      add(to, link.to);
    }
  }
  return relevant;
}

/**
 * Prepare symbols for the diagram. `changed`: a git change overlaps its lines (members are checked
 * the same way). `relevant`: see GraphSymbol; `'all'` marks everything relevant.
 */
function toGraphSymbols(
  symbols: SymbolInfo[],
  ranges: LineRange[] | undefined,
  relevant: 'all' | Set<string>,
  parent?: string,
): GraphSymbol[] {
  // `references` and their lines are analysis input; the diagram does not need them, so they are left out here.
  return symbols.map(({ members, references: _references, referenceLines: _referenceLines, ...symbol }) => {
    const key = parent ? `${parent}.${symbol.name}` : symbol.name;
    return {
      ...symbol,
      changed: ranges?.some((range) => range.start <= symbol.endLine && range.end >= symbol.startLine) ?? false,
      relevant: relevant === 'all' || relevant.has(key),
      ...(members ? { members: toGraphSymbols(members, ranges, relevant, symbol.name) } : {}),
    };
  });
}

/**
 * Suggested reading order for the changed files:
 *   1. Foundations first: a file comes after the changed files it imports, so by the time
 *      you read a consumer you already know what it relies on.
 *   2. Among files that are ready, the one with the most importers goes first, because
 *      a mistake there spreads furthest.
 *   3. Ties are broken by path so the order is stable.
 * Circular imports cannot satisfy rule 1; then the file with the fewest unread dependencies goes next.
 */
function orderForReview(
  changed: string[],
  byPath: Map<string, AnalyzedFile>,
  importedBy: Map<string, Set<string>>,
): string[] {
  const isChanged = new Set(changed);
  const dependenciesOf = (path: string) =>
    (byPath.get(path)?.imports ?? []).map((imported) => imported.file).filter((target) => isChanged.has(target) && target !== path);
  const importerCount = (path: string) => importedBy.get(path)?.size ?? 0;

  const remaining = new Set(changed);
  const order: string[] = [];

  while (remaining.size > 0) {
    const unreadDependencies = (path: string) => dependenciesOf(path).filter((dep) => remaining.has(dep)).length;

    // Best next file: fewest unread dependencies (0 when ready), then most importers, then path.
    const next = [...remaining].sort(
      (a, b) =>
        unreadDependencies(a) - unreadDependencies(b) || importerCount(b) - importerCount(a) || a.localeCompare(b),
    )[0];

    order.push(next);
    remaining.delete(next);
  }
  return order;
}
