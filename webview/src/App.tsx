import { Background, Controls, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';
import type { GraphModel, GraphScope } from '../../src/core/types';
import type { HostMessage } from '../../src/ui/messages';
import { toFlowElements } from './layout';
import { vscode } from './vscode';

type State =
  | { kind: 'loading'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'graph'; graph: GraphModel };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading', message: 'Starting...' });
  const [scope, setScope] = useState<GraphScope>('changes');

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (message.type === 'graph') {
        setScope(message.graph.scope);
        setState({ kind: 'graph', graph: message.graph });
      } else if (message.type === 'loading') {
        setState({ kind: 'loading', message: message.message });
      } else if (message.type === 'error') {
        setState({ kind: 'error', message: message.message });
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' }); // listener first, so the answer cannot be missed
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const chooseScope = (next: GraphScope) => {
    setScope(next);
    vscode.postMessage({ type: 'setScope', scope: next });
  };

  return (
    <div className="app">
      <header className="toolbar">
        <div className="scope-toggle" role="group" aria-label="View">
          <button aria-pressed={scope === 'changes'} onClick={() => chooseScope('changes')}>
            Changes
          </button>
          <button aria-pressed={scope === 'full'} onClick={() => chooseScope('full')}>
            Full system
          </button>
        </div>
        {state.kind === 'graph' && <Summary graph={state.graph} />}
      </header>
      <main className="canvas">
        <Body state={state} />
      </main>
    </div>
  );
}

function Summary({ graph }: { graph: GraphModel }) {
  const changed = graph.nodes.filter((node) => node.status === 'changed').length;
  return (
    <span className="summary">
      {graph.nodes.length} files, {graph.edges.length} dependencies, {changed} changed
    </span>
  );
}

function Body({ state }: { state: State }) {
  if (state.kind === 'loading') {
    return <p className="message">{state.message}</p>;
  }
  if (state.kind === 'error') {
    return <p className="message error">{state.message}</p>;
  }
  if (state.graph.nodes.length === 0) {
    return (
      <p className="message">
        {state.graph.scope === 'changes'
          ? 'No changes found. Edit some files, or switch to "Full system" to see everything.'
          : 'No supported files found in this folder.'}
      </p>
    );
  }
  return <Graph graph={state.graph} />;
}

function Graph({ graph }: { graph: GraphModel }) {
  const { nodes, edges } = useMemo(() => toFlowElements(graph), [graph]);
  // The editor theme decides light or dark; VS Code marks the page with a body class.
  const dark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');

  return (
    <ReactFlowProvider>
      <ReactFlow nodes={nodes} edges={edges} fitView colorMode={dark ? 'dark' : 'light'} nodesConnectable={false}>
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}
