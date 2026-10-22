import { Background, Controls, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import type { Edge } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GraphModel, GraphScope } from '../../src/core/types';
import type { HostMessage } from '../../src/ui/messages';
import { CardActions, FileCard } from './FileCard';
import type { RowMark } from './layout';
import { computeRoute, editorMarks, rangeOf } from './route';
import { splitPath } from './card';
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
  // What the pointer is over: a whole card, or one symbol row of it (`key`).
  const [hover, setHover] = useState<{ id: string; key?: string } | undefined>();
  const focus = useCallback((id: string, key?: string) => setHover({ id, key }), []);
  const blur = useCallback(() => setHover(undefined), []);

  // Click: show the symbol in the editor, with the symbols it uses and the ones that use it marked there.
  const open = useCallback(
    (id: string, key?: string) => {
      const node = graph.nodes.find((candidate) => candidate.id === id);
      if (!node || !elements) {
        return;
      }
      const own = key ? rangeOf(node, key) : undefined;
      const { highlights, sites } = editorMarks(graph.nodes, elements.edges, { id, key });

      vscode.postMessage({
        type: 'open',
        file: id,
        line: own?.startLine ?? 1,
        endLine: own?.endLine,
        origin: key ?? splitPath(id).name,
        highlights,
        sites,
      });
    },
    [graph, elements],
  );
  const actions = useMemo(() => ({ toggle, focus, blur, open }), [toggle, focus, blur, open]);

  // Arrows touching the hovered card (or symbol) are "hot"; everything else is dimmed.
  const view = useMemo(() => {
    if (!elements || !hover) {
      return elements;
    }
    const { start, downstream, upstream, edges: hotEdges } = computeRoute(elements.edges, hover);

    const related = new Set([hover.id]);
    const edges = elements.edges.map((edge) => {
      const hot = hotEdges.has(edge);
      if (hot) {
        related.add(edge.source).add(edge.target);
      }
      return { ...edge, className: hot ? 'is-hot' : 'is-dim', zIndex: hot ? 10 : 0 };
    });
    // Mark the rows on the route, so each card shows which of its symbols use / are used by the hovered one.
    const marksOf = (cardId: string): Record<string, RowMark> => {
      const marks: Record<string, RowMark> = {};
      const prefix = `${cardId}|`;
      for (const [set, mark] of [
        [upstream, 'usedBy'],
        [downstream, 'uses'],
        [start, 'self'],
      ] as const) {
        for (const end of set) {
          if (end.startsWith(prefix)) {
            marks[end.slice(prefix.length)] = mark;
          }
        }
      }
      return marks;
    };
    const nodes = elements.nodes.map((node) =>
      related.has(node.id)
        ? { ...node, data: { ...node.data, marks: marksOf(node.id) } }
        : { ...node, className: `${node.className ?? ''} is-dim` },
    );
    return { nodes, edges };
  }, [elements, hover]);

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
          nodes={view!.nodes}
          edges={view!.edges}
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
