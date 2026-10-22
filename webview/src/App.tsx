import { Background, Controls, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import type { Edge } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GraphModel, GraphScope } from '../../src/core/types';
import type { HostMessage } from '../../src/ui/messages';
import { CardActions, FileCard } from './FileCard';
import { layoutGraph, type FileCardNode } from './layout';
import { vscode } from './vscode';

type State =
  | { kind: 'loading'; message: string }
  | { kind: 'error'; message: string }
  // `version` changes with every graph the extension sends, so view state tied to one graph is reset.
  | { kind: 'graph'; graph: GraphModel; version: number };

// The kinds of node React Flow may draw. Defined once, outside the component, or React Flow would re-create every node on each render.
const nodeTypes = { fileCard: FileCard };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading', message: 'Starting...' });
  const [scope, setScope] = useState<GraphScope>('changes');

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (message.type === 'graph') {
        setScope(message.graph.scope);
        setState((previous) => ({
          kind: 'graph',
          graph: message.graph,
          version: previous.kind === 'graph' ? previous.version + 1 : 1,
        }));
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
  return <Graph key={state.version} graph={state.graph} />;
}

function Graph({ graph }: { graph: GraphModel }) {
  const [elements, setElements] = useState<{ nodes: FileCardNode[]; edges: Edge[] } | undefined>();
  // Cards the user opened to see every symbol. Each change needs a new layout: cards change height.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }, []);
  const actions = useMemo(() => ({ toggle }), [toggle]);

  // Layout is asynchronous, so the cards appear a moment after the data arrives. The old layout
  // stays on screen while a new one is computed, so expanding a card does not blank the graph.
  useEffect(() => {
    let cancelled = false; // a newer request may arrive before this layout finishes
    layoutGraph(graph, expanded).then(
      (result) => !cancelled && setElements(result),
      (error) => console.error('Layout failed', error),
    );
    return () => {
      cancelled = true;
    };
  }, [graph, expanded]);

  if (!elements) {
    return <p className="message">Laying out {graph.nodes.length} files...</p>;
  }

  // The editor theme decides light or dark; VS Code marks the page with a body class.
  const dark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');

  return (
    <CardActions.Provider value={actions}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={elements.nodes}
          edges={elements.edges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.1}
          colorMode={dark ? 'dark' : 'light'}
          nodesConnectable={false}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </CardActions.Provider>
  );
}
