import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useContext } from 'react';
import { ROW_HEIGHT, splitPath } from './card';
import { CardActions } from './FileCard';
import type { RouteFlowNode } from './layout';
import { ROUTE_HEADER } from './views/routesView';

/**
 * One URL segment of a file-routed framework: its path, the files that make it up (a layout, a
 * page, a route handler...) and, when routes sit below it, a fold control. Click a file to open it,
 * click the title to fold or unfold the routes below.
 */
export function RouteCard({ id, data }: NodeProps<RouteFlowNode>) {
  const { toggleNode, open } = useContext(CardActions);
  const { title, path, project, files, hiddenFiles, fold, changedCount } = data;

  return (
    <div className={`route-card${changedCount > 0 ? ' has-changes' : ''}`}>
      <Handle id="in" type="target" position={Position.Left} />
      <Handle id="out" type="source" position={Position.Right} />
      <header
        className={`route-card__header${fold ? ' is-foldable' : ''}`}
        style={{ height: ROUTE_HEADER }}
        title={[path, fold && (fold.collapsed ? 'click to show the routes below' : 'click to hide the routes below')].filter(Boolean).join(': ') || undefined}
        onClick={() => fold && toggleNode(id)}
      >
        <div className="route-card__title">
          {fold && <span aria-hidden>{fold.collapsed ? '▸' : '▾'}</span>}
          <span className="route-card__path">{title}</span>
          {fold?.collapsed && <span className="route-card__count">{fold.children} below</span>}
          {changedCount > 0 && <span className="chip chip-changed">{changedCount} changed</span>}
        </div>
        {project !== undefined && <div className="route-card__project">{project}</div>}
      </header>

      {files.map((file) => (
        <div
          key={file.id}
          className={`route-card__row status-${file.status}`}
          style={{ height: ROW_HEIGHT }}
          title={file.id}
          onClick={() => open(file.id)}
        >
          <span className="route-card__file">{splitPath(file.id).name}</span>
          {file.entryPoint && <span className="route-card__role">{file.entryPoint}</span>}
        </div>
      ))}
      {hiddenFiles > 0 && (
        <div className="route-card__row route-card__more" style={{ height: ROW_HEIGHT }}>
          +{hiddenFiles} more {hiddenFiles === 1 ? 'file' : 'files'}
        </div>
      )}
    </div>
  );
}
