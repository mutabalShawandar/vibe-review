import type { GraphNode, GraphSymbol, SymbolKind, SymbolRef } from '../../src/core/types';

// The card model: what one file card shows, row by row. Both the layout (which needs the
// card's height before anything is drawn) and the card component use it, so they always agree.

// Sizes in pixels. The card component applies exactly these, so the layout can rely on them.
export const CARD_WIDTH = 300;
export const HEADER_HEIGHT = 52;
export const ROW_HEIGHT = 24;
export const FOOTER_HEIGHT = 26;
export const CARD_PADDING = 6;

export interface CardRow {
  /** Identifies the row and its connection points: `UserService` or `UserService.find`. */
  key: string;
  label: string;
  kind: SymbolKind;
  changed: boolean;
  /** 0 for a symbol, 1 for a member of a class or interface. */
  depth: 0 | 1;
}

export interface Card {
  rows: CardRow[];
  /** Symbols and members that exist in the file but are not shown right now. */
  hiddenCount: number;
  /** Whether the footer ("+N more" / "Show less") is shown. */
  hasFooter: boolean;
}

export const portKey = (symbol: string, member?: string) => (member ? `${symbol}.${member}` : symbol);

/**
 * The rows of a card. Normally only the relevant symbols are listed (see GraphSymbol.relevant);
 * an expanded card lists everything the file declares.
 */
export function buildCard(node: GraphNode, expanded: boolean): Card {
  const rows: CardRow[] = [];
  let total = 0;

  const add = (symbol: GraphSymbol, depth: 0 | 1, parent?: string) => {
    total++;
    if (expanded || symbol.relevant) {
      rows.push({
        key: portKey(parent ?? symbol.name, parent ? symbol.name : undefined),
        label: symbol.name,
        kind: symbol.kind,
        changed: symbol.changed,
        depth,
      });
    }
  };

  for (const symbol of node.symbols) {
    add(symbol, 0);
    for (const member of symbol.members ?? []) {
      add(member, 1, symbol.name);
    }
  }

  const hiddenCount = total - rows.length;
  return { rows, hiddenCount, hasFooter: hiddenCount > 0 || expanded };
}

export function cardHeight(card: Card): number {
  return HEADER_HEIGHT + card.rows.length * ROW_HEIGHT + (card.hasFooter ? FOOTER_HEIGHT : 0) + CARD_PADDING;
}

/** Connection point used for links to or from the file as a whole (the card header). */
export const FILE_PORT = 'file';

/**
 * Which connection point of a card an arrow should use for a symbol. When the symbol's row is
 * hidden the arrow goes to the closest thing that is visible: the class that contains a hidden
 * member, otherwise the card header.
 */
export function visiblePort(card: Card, ref: SymbolRef | undefined): string {
  if (!ref) {
    return FILE_PORT;
  }
  const keys = new Set(card.rows.map((row) => row.key));
  for (const candidate of [portKey(ref.symbol, ref.member), portKey(ref.symbol)]) {
    if (keys.has(candidate)) {
      return candidate;
    }
  }
  return FILE_PORT;
}

/** A path split for display: `app/(platform)/users/page.tsx` -> name `page.tsx`, folder `app/(platform)/users`. */
export function splitPath(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? { name: path, folder: '' } : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}
