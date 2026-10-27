import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useContext } from 'react';
import { CardActions } from './FileCard';
import { GROUP_HEADER, type GroupFlowNode } from './layout';

const filesLabel = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`;

/** A folder with its files hidden: one small card that stands for all of them. Click to open it. */
export function GroupCard({ data }: NodeProps<GroupFlowNode>) {
  const { toggleGroup } = useContext(CardActions);
  const { group, changedCount } = data;

  return (
    <div
      className={`group-card${changedCount > 0 ? ' has-changes' : ''}`}
      title={`${group.key || 'workspace root'}: click to show its files`}
      onClick={() => toggleGroup(group.key)}
    >
      <Handle id="s:file" type="source" position={Position.Left} />
      <Handle id="t:file" type="target" position={Position.Right} />
      <div className="group-card__name">
        <span className="group-card__icon" aria-hidden>
          ▸
        </span>
        {group.label}
      </div>
      <div className="group-card__meta">
        {filesLabel(group.ids.length)}
        {changedCount > 0 && <span className="chip chip-changed">{changedCount} changed</span>}
      </div>
    </div>
  );
}

/** The frame around the files of an open folder. Only its title takes clicks; the files inside are cards of their own. */
export function GroupBox({ data }: NodeProps<GroupFlowNode>) {
  const { toggleGroup } = useContext(CardActions);
  const { group, changedCount } = data;

  return (
    <div className="group-box" style={{ width: '100%', height: '100%' }}>
      <button
        className="group-box__title nodrag"
        style={{ height: GROUP_HEADER }}
        title={`${group.key || 'workspace root'}: click to hide its files`}
        onClick={() => toggleGroup(group.key)}
      >
        <span aria-hidden>▾</span> {group.label}
        <span className="group-box__count">{filesLabel(group.ids.length)}</span>
        {changedCount > 0 && <span className="chip chip-changed">{changedCount} changed</span>}
      </button>
    </div>
  );
}
