import { Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type NodeProps } from '@xyflow/react';
import { useEffect, useState, type CSSProperties } from 'react';
import type { GraphModel } from '../../src/core/types';
import { layoutFolders, type FolderNode } from './folders';

function FolderBox({ data }: NodeProps<FolderNode>) {
  const { folder, color, roleLabel, names } = data;
  const more = folder.files.length - names.length;
  return (
    <div className={`folder-box${folder.changed > 0 ? ' has-changes' : ''}`} style={{ '--role': color ?? 'var(--vr-line)' } as CSSProperties} title={folder.files.join('\n')}>
      <Handle type="source" position={Position.Left} />
      <Handle type="target" position={Position.Right} />
      <div className="folder-box__title">{folder.id}</div>
      <div className="folder-box__meta">
        {roleLabel && <span className="role-chip">{roleLabel}</span>}
        <span>{folder.files.length} files</span>
        {folder.changed > 0 && <span className="chip chip-changed">{folder.changed} changed</span>}
      </div>
      <div className="folder-box__names">
        {names.join(', ')}
        {more > 0 ? ` +${more}` : ''}
      </div>
    </div>
  );
}

const nodeTypes = { folder: FolderBox };

/** The whole system at a glance: a box per folder and an arrow per pair of folders that depend on each other. */
export function FolderOverview({ graph }: { graph: GraphModel }) {
  const [elements, setElements] = useState<{ nodes: FolderNode[]; edges: Edge[] } | undefined>();
  useEffect(() => {
    let cancelled = false;
    layoutFolders(graph).then(
      (result) => !cancelled && setElements(result),
      (error) => console.error('Folder layout failed', error),
    );
    return () => {
      cancelled = true;
    };
  }, [graph]);

  if (!elements) {
    return <p className="message">Laying out folders...</p>;
  }
  const dark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
  return (
    <div className="flow">
      <ReactFlowProvider>
        <ReactFlow nodes={elements.nodes} edges={elements.edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.12 }} minZoom={0.1} colorMode={dark ? 'dark' : 'light'} nodesConnectable={false}>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
