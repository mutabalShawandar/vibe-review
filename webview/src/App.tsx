import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import type { Edge } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphModel, GraphScope } from '../../src/core/types';
import type { HostMessage } from '../../src/ui/messages';
import { CardActions, FileCard } from './FileCard';
import type { RowMark } from './layout';
import { computeRoute, editorMarks, rangeOf } from './route';
import { CARD_WIDTH, splitPath } from './card';
import { layoutGraph, type FileCardNode } from './layout';
import { freshSince, type Fresh } from './fresh';
import { computeFeatures } from './review';
import { PLACEHOLDER_HEIGHT, PlaceholderCard, type PlaceholderNode } from './PlaceholderCard';
import { Sidebar } from './Sidebar';
import { vscode } from './vscode';

type State =
  | { kind: 'loading'; message: string }
  | { kind: 'error'; message: string }
  // `version` changes with every graph the extension sends, so view state tied to one graph is reset.
  | { kind: 'graph'; graph: GraphModel; version: number; touched: string[] };

/** How the view follows live edits: `latest` zooms in on the file being edited, `all` fits every file edited, `off` stays put. */
type FollowMode = 'latest' | 'all' | 'off';

// The kinds of node React Flow may draw. Defined once, outside the component, or React Flow would re-create every node on each render.
const nodeTypes = { fileCard: FileCard, placeholder: PlaceholderCard };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading', message: 'Starting...' });
  const [scope, setScope] = useState<GraphScope>('changes');
  // Show every symbol of every card, instead of only what changed in the big ones.
  const [fullView, setFullView] = useState(false);
  // Follow the live edits. Moving the view by hand pauses it until the reader resumes.
  const [follow, setFollow] = useState<FollowMode>('latest');
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (message.type === 'graph') {
        setScope(message.graph.scope);
        setState((previous) => ({
          kind: 'graph',
          graph: message.graph,
          touched: message.touched,
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
        <button className="toggle-button" aria-pressed={fullView} onClick={() => setFullView(!fullView)} title="Show every symbol of every file, not only what changed in the big ones">
          Full view
        </button>
        <label className="follow" title="Move the view to the files the agent just edited">
          Follow
          <select
            value={follow}
            onChange={(event) => {
              setFollow(event.target.value as FollowMode);
              setPaused(false);
            }}
          >
            <option value="latest">Zoom to the edited file</option>
            <option value="all">Fit all edited files</option>
            <option value="off">Off</option>
          </select>
        </label>
        {paused && follow !== 'off' && (
          <button className="toggle-button" onClick={() => setPaused(false)} title="You moved the view; follow the edits again">
            Resume follow
          </button>
        )}
        {state.kind === 'graph' && <Summary graph={state.graph} />}
        <Legend />
      </header>
      <main className="canvas">
        <Body state={state} fullView={fullView} setFullView={setFullView} follow={follow} paused={paused} setPaused={setPaused} />
      </main>
    </div>
  );
}

/** What the colors mean, in the graph and in the code the graph opens. */
function Legend() {
  const items: [string, string][] = [
    ['var(--vr-self)', 'clicked'],
    ['var(--vr-uses)', 'it uses'],
    ['var(--vr-usedby)', 'uses it'],
    ['var(--vr-changed)', 'changed'],
  ];
  return (
    <span className="legend" title="Hover a symbol to see its route. In the editor the same colors mark the code; the stronger line is where the name is written.">
      {items.map(([color, label]) => (
        <span key={label} className="legend__item">
          <span className="legend__swatch" style={{ background: color }} />
          {label}
        </span>
      ))}
    </span>
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

/** Shown when the diagram has no files. If a file is written meanwhile, say that the agent is at work. */
function EmptyState({ scope }: { scope: GraphScope }) {
  const [working, setWorking] = useState<string[]>([]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (event: MessageEvent<HostMessage>) => {
      if (event.data.type !== 'editing') {
        return;
      }
      const files = event.data.files;
      setWorking((previous) => [...new Set([...previous, ...files])]);
      clearTimeout(timer);
      timer = setTimeout(() => setWorking([]), 4000); // the refresh normally replaces this view before then
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
  }, []);

  if (working.length > 0) {
    return (
      <div className="message working">
        <span className="typing">
          <i />
          <i />
          <i />
        </span>{' '}
        Agent is working on {working.map((file) => splitPath(file).name).join(', ')}
        <div className="placeholder-card__hint">It appears here as soon as the edit settles.</div>
      </div>
    );
  }
  return (
    <p className="message">
      {scope === 'changes'
        ? 'No changes found. Edit some files, or switch to "Full system" to see everything.'
        : 'No supported files found in this folder.'}
    </p>
  );
}

function Body({
  state,
  fullView,
  setFullView,
  follow,
  paused,
  setPaused,
}: {
  state: State;
  fullView: boolean;
  setFullView(value: boolean): void;
  follow: FollowMode;
  paused: boolean;
  setPaused(value: boolean): void;
}) {
  if (state.kind === 'loading') {
    return <p className="message">{state.message}</p>;
  }
  if (state.kind === 'error') {
    return <p className="message error">{state.message}</p>;
  }
  if (state.graph.nodes.length === 0) {
    return <EmptyState scope={state.graph.scope} />;
  }
  return (
    <ReactFlowProvider>
      <Graph
        key={state.graph.scope}
        graph={state.graph}
        touched={state.touched}
        fullView={fullView}
        setFullView={setFullView}
        follow={follow}
        paused={paused}
        setPaused={setPaused}
      />
    </ReactFlowProvider>
  );
}

function Graph({
  graph,
  touched,
  fullView,
  setFullView,
  follow,
  paused,
  setPaused,
}: {
  graph: GraphModel;
  touched: string[];
  fullView: boolean;
  setFullView(value: boolean): void;
  follow: FollowMode;
  paused: boolean;
  setPaused(value: boolean): void;
}) {
  const { fitView } = useReactFlow();
  const [elements, setElements] = useState<{ nodes: FileCardNode[]; edges: Edge[] } | undefined>();
  // Cards the user opened to see every symbol. Each change needs a new layout: cards change height.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // In the full view every card is open. Collapsing one leaves the full view and keeps the others open.
  const shown = useMemo(() => (fullView ? new Set(graph.nodes.map((node) => node.id)) : expanded), [fullView, graph, expanded]);
  const toggle = useCallback(
    (id: string) => {
      const next = new Set(shown);
      if (!next.delete(id)) {
        next.add(id);
      }
      setExpanded(next);
      setFullView(false);
    },
    [shown, setFullView],
  );
  // What the pointer is over: a whole card, or one symbol row of it (`key`).
  const [hover, setHover] = useState<{ id: string; key?: string } | undefined>();
  const focus = useCallback((id: string, key?: string) => setHover({ id, key }), []);
  const blur = useCallback(() => setHover(undefined), []);

  // Click: show the symbol in the editor, with the symbols it uses and the ones that use it marked there.
  const open = useCallback(
    (id: string, key?: string, focusLine?: number) => {
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
        focusLine,
        origin: key ?? splitPath(id).name,
        highlights,
        sites,
      });
    },
    [graph, elements],
  );
  const actions = useMemo(() => ({ toggle, focus, blur, open }), [toggle, focus, blur, open]);

  // A link in the editor hover asked to walk to another symbol of the route.
  useEffect(() => {
    const onMessage = (event: MessageEvent<HostMessage>) => {
      if (event.data.type === 'navigate') {
        open(event.data.file, event.data.key, event.data.line);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open]);
  const features = useMemo(() => computeFeatures(graph), [graph]);

  // What the last edits touched: compared with the previous graph each time a new one arrives.
  const previousGraph = useRef(graph);
  const [fresh, setFresh] = useState<Fresh | undefined>();
  const pendingFollow = useRef<string[]>([]);

  // Files being written right now (a write was seen in the last moment). They show a typing indicator.
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const editingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = editingTimers.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);
  useEffect(() => {
    const found = freshSince(previousGraph.current, graph, touched);
    previousGraph.current = graph;
    if (found.files.length === 0) {
      return;
    }
    setFresh(found);
    pendingFollow.current = found.files;
    const timer = setTimeout(() => setFresh(undefined), 8000); // the pulse fades; the marks go with it
    return () => clearTimeout(timer);
  }, [graph]); // eslint-disable-line react-hooks/exhaustive-deps -- `touched` always arrives together with `graph`

  // The cards of freshly edited files carry their fresh rows, which pulse for a few seconds.
  const base = useMemo(() => {
    if (!elements || (!fresh && editing.size === 0)) {
      return elements;
    }
    const files = new Set(fresh?.files);

    return {
      ...elements,
      nodes: elements.nodes.map((node) =>
        files.has(node.id) || editing.has(node.id)
          ? {
              ...node,
              data: {
                ...node.data,
                ...(files.has(node.id) ? { fresh: { rows: fresh?.rows.get(node.id) ?? new Set<string>() } } : {}),
                ...(editing.has(node.id) ? { editing: true } : {}),
              },
            }
          : node,
      ),
    };
  }, [elements, fresh, editing]);

  // Files being written that are not in the diagram yet get a placeholder card, stacked to the
  // right of the graph so it never covers a real card.
  const placeholders = useMemo((): PlaceholderNode[] => {
    if (!elements || editing.size === 0) {
      return [];
    }
    const known = new Set(elements.nodes.map((node) => node.id));
    const right = Math.max(0, ...elements.nodes.map((node) => node.position.x + (node.width ?? 0)));
    const top = Math.min(0, ...elements.nodes.map((node) => node.position.y));
    return [...editing]
      .filter((file) => !known.has(file))
      .map((file, index) => ({
        id: file,
        type: 'placeholder',
        position: { x: elements.nodes.length > 0 ? right + 140 : 0, y: top + index * (PLACEHOLDER_HEIGHT + 24) },
        width: CARD_WIDTH,
        height: PLACEHOLDER_HEIGHT,
        data: { file },
        draggable: false,
        selectable: false,
      }));
  }, [elements, editing]);

  // Arrows touching the hovered card (or symbol) are "hot"; everything else is dimmed.
  const view = useMemo(() => {
    if (!base || !hover) {
      return base;
    }
    const elements = base;
    const { start, downstream, upstream, edges: hotEdges } = computeRoute(elements.edges, hover);

    // Rows on the route that a collapsed card hides are shown while the route is highlighted.
    const reveal = new Map<string, Set<string>>();
    for (const end of new Set([...start, ...downstream, ...upstream])) {
      const split = end.indexOf('|');
      const keys = reveal.get(end.slice(0, split)) ?? new Set<string>();
      reveal.set(end.slice(0, split), keys.add(end.slice(split + 1)));
    }

    const related = new Set([hover.id]);
    const edges = elements.edges.map((edge) => {
      const hot = hotEdges.has(edge);
      if (hot) {
        related.add(edge.source).add(edge.target);
        // An arrow of the route attaches to its real symbols, now that their rows are shown.
        const fromKey = edge.data?.fromKey as string | undefined;
        const toKey = edge.data?.toKey as string | undefined;
        return {
          ...edge,
          sourceHandle: fromKey && reveal.get(edge.source)?.has(fromKey) ? `s:${fromKey}` : edge.sourceHandle,
          targetHandle: toKey && reveal.get(edge.target)?.has(toKey) ? `t:${toKey}` : edge.targetHandle,
          className: 'is-hot',
          zIndex: 10,
        };
      }
      return { ...edge, className: 'is-dim', zIndex: 0 };
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
        ? { ...node, zIndex: 1000, data: { ...node.data, marks: marksOf(node.id), reveal: reveal.get(node.id) } }
        : { ...node, className: `${node.className ?? ''} is-dim` },
    );
    return { nodes, edges };
  }, [base, hover]);

  // --- Follow the edits ---
  // The view keeps moving to the file being written: every write report pans to it (unless the
  // reader moved the view), so with an agent hopping between files the view hops along.
  const followRef = useRef({ follow, paused });
  followRef.current = { follow, paused };
  const lastFollowMove = useRef(0);
  const trailingMove = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editingNow = useRef<string[]>([]); // files being written, oldest first

  const moveTo = useCallback(
    (files: string[], force = false) => {
      const { follow: mode, paused: stopped } = followRef.current;
      if (mode === 'off' || stopped || files.length === 0) {
        return;
      }
      // Moving the view takes about a second; asking again sooner would make it jitter. The last
      // request in a quick series is kept and runs when the current move is over.
      const wait = 900 - (Date.now() - lastFollowMove.current);
      clearTimeout(trailingMove.current);
      if (wait > 0 && !force) {
        trailingMove.current = setTimeout(() => moveTo(files, true), wait);
        return;
      }
      lastFollowMove.current = Date.now();
      const target = mode === 'latest' ? files.slice(-1) : files;
      // One file: zoom in on it. Several: fit them all.
      void fitView({ nodes: target.map((id) => ({ id })), duration: 700, maxZoom: target.length === 1 ? 1.1 : 1, padding: 0.35 });
    },
    [fitView],
  );
  useEffect(() => () => clearTimeout(trailingMove.current), []);

  const userMoved = useCallback(
    (event: unknown) => {
      // Our own animation also reports a move; only a move well after it can be the reader's.
      if (event && Date.now() - lastFollowMove.current > 1200) {
        setPaused(true);
      }
    },
    [setPaused],
  );

  // The host reports writes within a fraction of a second: show "editing" on those files and go there.
  useEffect(() => {
    const ids = new Set(graph.nodes.map((node) => node.id));
    const onMessage = (event: MessageEvent<HostMessage>) => {
      if (event.data.type !== 'editing') {
        return;
      }
      const files = event.data.files;
      if (files.length === 0) {
        return;
      }
      setEditing((previous) => new Set([...previous, ...files]));
      for (const file of files) {
        clearTimeout(editingTimers.current.get(file));
        editingTimers.current.set(
          file,
          setTimeout(() => {
            editingTimers.current.delete(file);
            editingNow.current = editingNow.current.filter((name) => name !== file);
            setEditing((previous) => new Set([...previous].filter((name) => name !== file)));
          }, 2500), // "being edited" ends when no write has come for this long
        );
        editingNow.current = [...editingNow.current.filter((name) => name !== file), file];
      }
      const go = () => moveTo(follow === 'all' ? editingNow.current : files);
      // A placeholder card has to be on screen before the view can move to it.
      files.some((file) => !ids.has(file)) ? setTimeout(go, 100) : go();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [graph, follow, moveTo]);

  // A refresh re-lays the graph out, which can move the cards: go to the edited ones again.
  useEffect(() => {
    if (!elements || pendingFollow.current.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      const files = [...pendingFollow.current].reverse(); // moveTo wants the newest last
      pendingFollow.current = [];
      moveTo(files, true);
    }, 80);
    return () => clearTimeout(timer);
  }, [elements]); // eslint-disable-line react-hooks/exhaustive-deps -- only a new layout may start a move

  // Layout is asynchronous, so the cards appear a moment after the data arrives. The old layout
  // stays on screen while a new one is computed, so expanding a card does not blank the graph.
  useEffect(() => {
    let cancelled = false; // a newer request may arrive before this layout finishes
    layoutGraph(graph, shown).then(
      (result) => !cancelled && setElements(result),
      (error) => console.error('Layout failed', error),
    );
    return () => {
      cancelled = true;
    };
  }, [graph, shown]);

  if (!elements) {
    return <p className="message">Laying out {graph.nodes.length} files...</p>;
  }

  // The editor theme decides light or dark; VS Code marks the page with a body class.
  const dark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');

  return (
    <CardActions.Provider value={actions}>
      <Sidebar
        features={features}
        onPick={(id) => {
          void fitView({ nodes: [{ id }], duration: 400, maxZoom: 1, padding: 0.4 }); // bring the card into view
          open(id);
        }}
        onHover={focus}
        onLeave={blur}
      />
      <div className="flow">
        <ReactFlow
          nodes={[...view!.nodes, ...placeholders]}
          edges={view!.edges}
          nodeTypes={nodeTypes}
          fitView
          onMoveStart={userMoved}
          minZoom={0.1}
          colorMode={dark ? 'dark' : 'light'}
          nodesConnectable={false}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </CardActions.Provider>
  );
}
