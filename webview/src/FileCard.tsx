import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { createContext, useContext, useEffect, useMemo } from 'react';
import type { NodeStatus, SymbolKind } from '../../src/core/types';
import { buildCard, CARD_WIDTH, FOOTER_HEIGHT, HEADER_HEIGHT, ROW_HEIGHT, splitPath } from './card';
import type { FileCardNode } from './layout';

/** Lets a card ask the app to expand or collapse it, without passing callbacks through React Flow's node data. */
export const CardActions = createContext<{
  toggle(id: string): void;
  /** The pointer is over a card (or one symbol row of it): highlight what it is connected to. */
  focus(id: string, key?: string): void;
  blur(): void;
  /** Open a symbol (or the file, without `key`) in the editor and mark its route in the code. */
  open(id: string, key?: string): void;
  /** Open or close a node that stands for several files, such as a folder box. */
  toggleNode(nodeId: string): void;
}>({ toggle() {}, focus() {}, blur() {}, open() {}, toggleNode() {} });

// A short mark and a name for each kind of symbol, like the icons in a class diagram.
const KIND: Record<SymbolKind, { mark: string; name: string }> = {
  class: { mark: 'C', name: 'class' },
  interface: { mark: 'I', name: 'interface' },
  function: { mark: 'ƒ', name: 'function' },
  component: { mark: 'U', name: 'component' },
  hook: { mark: 'H', name: 'hook' },
  type: { mark: 'T', name: 'type' },
  enum: { mark: 'E', name: 'enum' },
  variable: { mark: 'V', name: 'variable' },
  method: { mark: 'm', name: 'method' },
  property: { mark: 'p', name: 'property' },
};

const STATUS_LABEL: Record<NodeStatus, string> = {
  changed: 'changed',
  dependent: 'uses a change',
  dependency: 'used by a change',
  unchanged: '',
};

/**
 * One file as a class-diagram card: the file name, then one row per symbol (members of a class
 * indented under it). Every row has two connection points: arrows leave on the left, where the
 * symbol uses something, and arrive on the right, where something else uses the symbol.
 */
export function FileCard({ id, data }: NodeProps<FileCardNode>) {
  const { node, expanded, marks, review, reveal, fresh, editing } = data;
  // Hovering a route lists the rows on it that the card normally hides (the card grows downward over its neighbors).
  const card = useMemo(() => (reveal ? buildCard(node, expanded, reveal) : data.card), [node, expanded, reveal, data.card]);
  const { toggle, focus, blur, open } = useContext(CardActions);
  const updateNodeInternals = useUpdateNodeInternals();

  // Rows appear and disappear when the card is expanded; React Flow must measure the new connection points.
  useEffect(() => updateNodeInternals(id), [id, card.rows.length, updateNodeInternals]);

  const { name, folder } = splitPath(node.id);
  const seenKeys = new Set<string>(); // a type and a function can share a name; only the first row gets arrows

  return (
    <div className={`file-card status-${node.status}${fresh ? ' is-fresh' : ''}${editing ? ' is-editing' : ''}`} style={{ width: CARD_WIDTH }} onMouseLeave={blur}>
      <header
        className="file-card__header"
        style={{ height: HEADER_HEIGHT }}
        title={node.id}
        onMouseEnter={() => focus(id)}
        onClick={() => open(id)}
      >
        <Handle id="s:file" type="source" position={Position.Left} />
        <Handle id="t:file" type="target" position={Position.Right} />
        <div className="file-card__title">
          {review && (
            <span className="order-badge" style={{ background: review.color }} title={`Step ${review.order} of its feature`}>
              {review.order}
            </span>
          )}
          <span className="file-card__name">{name}</span>
          {STATUS_LABEL[node.status] && <span className={`chip chip-${node.status}`}>{STATUS_LABEL[node.status]}</span>}
          {editing && (
            <span className="chip chip-editing" title="This file is being written right now">
              editing
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
            </span>
          )}
          {review?.order === 1 && <span className="chip chip-start">start here</span>}
          {node.entryPoint && <span className="chip chip-entry">{node.entryPoint}</span>}
        </div>
        {folder && <div className="file-card__folder">{folder}</div>}
      </header>

      {card.rows.map((row, index) => {
        const first = !seenKeys.has(row.key);
        seenKeys.add(row.key);
        return (
          <div
            key={`${index}:${row.key}`}
            className={`file-card__row depth-${row.depth}${row.changed ? ' is-changed' : ''}${marks?.[row.key] ? ` mark-${marks[row.key]}` : ''}${fresh?.rows.has(row.key) ? ' row-fresh' : ''}`}
            style={{ height: ROW_HEIGHT }}
            onMouseEnter={() => focus(id, row.key)}
            onClick={() => open(id, row.key)}
            title={`${KIND[row.kind].name} ${row.label}${row.changed ? ' (changed)' : ''}`}
          >
            {first && <Handle id={`s:${row.key}`} type="source" position={Position.Left} />}
            {first && <Handle id={`t:${row.key}`} type="target" position={Position.Right} />}
            <span className={`kind-badge kind-${row.kind}`}>{KIND[row.kind].mark}</span>
            <span className="file-card__label">{row.label}</span>
          </div>
        );
      })}

      {card.hasFooter && (
        <button className="file-card__footer nodrag" style={{ height: FOOTER_HEIGHT }} onClick={() => toggle(id)}>
          {expanded ? 'Show less' : `+${card.hiddenCount} more`}
        </button>
      )}
    </div>
  );
}
