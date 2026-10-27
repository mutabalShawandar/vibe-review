import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import type { Edge } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphModel, GraphScope } from '../../src/core/types';
import type { HostMessage } from '../../src/ui/messages';
import { CardActions } from './FileCard';
import type { RowMark } from './layout';
import { computeRoute, editorMarks, rangeOf } from './route';
import { CARD_WIDTH, splitPath } from './card';
import { absolutePosition, type FlowNode } from './layout';
import { nodeTypes } from './views/nodeTypes';
import { rendererFor, viewKindFor, viewsFor } from './views';
import { freshSince, type Fresh } from './fresh';
import { computeFeatures } from './review';
import { PLACEHOLDER_HEIGHT, type PlaceholderNode } from './PlaceholderCard';
import { Sidebar } from './Sidebar';
import { vscode } from './vscode';

type State =
  | { kind: 'loading'; message: string }
  | { kind: 'error'; message: string }
  // `version` changes with every graph the extension sends, so view state tied to one graph is reset.
  | { kind: 'graph'; graph: GraphModel; version: number; touched: string[] };

/** How the view follows live edits: `latest` zooms in on the file being edited, `all` fits every file edited, `off` stays put. */
type FollowMode = 'latest' | 'all' | 'off';

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading', message: 'Starting...' });
  const [scope, setScope] = useState<GraphScope>('changes');
  // Show every symbol of every card, instead of only what changed in the big ones.
  const [fullView, setFullView] = useState(false);
  // Follow the live edits. Moving the view by hand pauses it until the reader resumes.
  const [follow, setFollow] = useState<FollowMode>('latest');
  const [paused, setPaused] = useState(false);
  // Bumped by "Resume follow"; the graph goes to the file being edited, or else the one edited last.
  const [resumes, setResumes] = useState(0);

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

  // The reader can pick another view of the same graph when more than one fits (Folders or Routes).
  const [chosenView, setChosenView] = useState<string | undefined>();
  const views = state.kind === 'graph' ? viewsFor(state.graph) : [];
  const viewKind = state.kind === 'graph' ? viewKindFor(state.graph, chosenView) : '';

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
        {views.length > 1 && (
          <label className="follow" title="How the graph is drawn">
            View
            <select value={viewKind} onChange={(event) => setChosenView(event.target.value)}>
              {views.map((view) => (
                <option key={view.kind} value={view.kind}>
                  {view.label}
                </option>
              ))}
            </select>
          </label>
        )}
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
          <button
            className="toggle-button"
            onClick={() => {
              setPaused(false);
              setResumes((count) => count + 1);
            }}
            title="You moved the view; go to the file being edited (or the one edited last) and follow again"
          >
            Resume follow
          </button>
        )}
        {state.kind === 'graph' && <Summary graph={state.graph} />}
        <Legend />
      </header>
      <main className="canvas">
        <Body state={state} viewKind={viewKind} fullView={fullView} setFullView={setFullView} follow={follow} paused={paused} setPaused={setPaused} resumes={resumes} />
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
  viewKind,
  fullView,
  setFullView,
  follow,
  paused,
  setPaused,
  resumes,
}: {
  state: State;
  viewKind: string;
  fullView: boolean;
  setFullView(value: boolean): void;
  follow: FollowMode;
  paused: boolean;
  setPaused(value: boolean): void;
  resumes: number;
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
        viewKind={viewKind}
        touched={state.touched}
        fullView={fullView}
        setFullView={setFullView}
        follow={follow}
        paused={paused}
        setPaused={setPaused}
        resumes={resumes}
      />
    </ReactFlowProvider>
  );
}

function Graph({
  graph,
  viewKind,
  touched,
  fullView,
  setFullView,
  follow,
  paused,
  setPaused,
  resumes,
}: {
  graph: GraphModel;
  viewKind: string;
  touched: string[];
  fullView: boolean;
  setFullView(value: boolean): void;
  follow: FollowMode;
  paused: boolean;
  setPaused(value: boolean): void;
  resumes: number;
}) {
  const { fitView, fitBounds, setCenter } = useReactFlow();
  const flowRef = useRef<HTMLDivElement>(null); // the canvas, to know how much room the camera has
  const [elements, setElements] = useState<{ nodes: FlowNode[]; edges: Edge[] } | undefined>();
  // Cards the user opened to see every symbol. Each change needs a new layout: cards change height.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // The active view decides where everything goes. What the reader changed in it (open folders...) is its state.
  const renderer = useMemo(() => rendererFor(viewKind), [viewKind]);
  const [viewStates, setViewStates] = useState<Readonly<Record<string, unknown>>>({});
  const viewState = viewStates[renderer.kind] ?? renderer.initialState;
  const toggleNode = useCallback(
    (nodeId: string) =>
      setViewStates((previous) => ({
        ...previous,
        [renderer.kind]: renderer.toggleNode(graph, previous[renderer.kind] ?? renderer.initialState, nodeId),
      })),
    [renderer, graph],
  );
  /**
   * Make sure these files have cards (their folders may be closed), for the sidebar and for following edits.
   * All of them are revealed in one state change, so opening several folders at once keeps every one.
   * True if the view had to change.
   */
  const showFiles = useCallback(
    (ids: readonly string[]) => {
      const next = ids.reduce((state, id) => renderer.reveal(graph, state, id), viewState);
      if (next === viewState) {
        return false;
      }
      setViewStates((previous) => ({ ...previous, [renderer.kind]: next }));
      return true;
    },
    [renderer, graph, viewState],
  );

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
  const actions = useMemo(() => ({ toggle, focus, blur, open, toggleNode }), [toggle, focus, blur, open, toggleNode]);

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
  // A file picked in the sidebar whose folder had to be opened first: the camera goes to it once its card exists.
  const pendingFit = useRef<string | undefined>(undefined);

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
    lastEdited.current = found.files[0] ?? lastEdited.current; // newest first
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
        node.type === 'fileCard' && (files.has(node.id) || editing.has(node.id))
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
    // A file inside a collapsed folder has no card but is not new: only files the graph lacks get a placeholder.
    const known = new Set([...elements.nodes.map((node) => node.id), ...graph.nodes.map((node) => node.id)]);
    const spots = elements.nodes.map((node) => ({ ...absolutePosition(node, elements.nodes), width: node.width ?? 0 }));
    const right = Math.max(0, ...spots.map((spot) => spot.x + spot.width));
    const top = Math.min(0, ...spots.map((spot) => spot.y));
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
  }, [elements, editing, graph]);

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
    const nodes = elements.nodes.map((node): FlowNode => {
      if (node.type === 'groupBox') {
        return node; // a frame stays as it is: dimming it would dim the files inside it
      }
      if (!related.has(node.id)) {
        return { ...node, className: `${node.className ?? ''} is-dim` };
      }
      return node.type === 'fileCard'
        ? { ...node, zIndex: 1000, data: { ...node.data, marks: marksOf(node.id), reveal: reveal.get(node.id) } }
        : { ...node, zIndex: 1000 };
    });
    return { nodes, edges };
  }, [base, hover]);

  // Fit the whole graph once, when its first layout is on screen. (React Flow's own fit-on-load
  // measured only one card here and zoomed far into it.)
  const fitted = useRef(false);
  useEffect(() => {
    fitted.current = false; // another view is another picture: fit it too
  }, [renderer]);
  useEffect(() => {
    if (!elements || fitted.current) {
      return;
    }
    fitted.current = true;
    const timer = setTimeout(() => void fitView({ padding: 0.15, duration: 0 }), 100);
    return () => clearTimeout(timer);
  }, [elements, fitView]);

  // --- Follow the edits ---
  // The view keeps moving to the file being written: every write report pans to it (unless the
  // reader moved the view), so with an agent hopping between files the view hops along.
  // What is on screen right now, for the camera to aim at (the camera callbacks outlive renders).
  const shownNodes = useRef({ elements, placeholders });
  shownNodes.current = { elements, placeholders };
  const followRef = useRef({ follow, paused });
  followRef.current = { follow, paused };
  const lastFollowMove = useRef(0);
  const trailingMove = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editingNow = useRef<string[]>([]); // files being written, oldest first
  const lastEdited = useRef<string | undefined>(undefined); // the file written most recently

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
      // The rectangle to show, from our own layout: cards and placeholders as they are on screen now.
      const target = (mode === 'latest' ? files.slice(-1) : files).map((file) => renderer.nodeFor(graph, file));
      const rects = [...(shownNodes.current.elements?.nodes ?? []), ...shownNodes.current.placeholders]
        .filter((node) => target.includes(node.id))
        .map((node) => ({ ...absolutePosition(node as FlowNode, shownNodes.current.elements?.nodes ?? []), width: node.width ?? 300, height: node.height ?? 120 }));
      if (rects.length === 0) {
        return;
      }
      const left = Math.min(...rects.map((rect) => rect.x));
      const top = Math.min(...rects.map((rect) => rect.y));
      const right = Math.max(...rects.map((rect) => rect.x + rect.width));
      const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));

      lastFollowMove.current = Date.now();
      const width = right - left;
      const height = bottom - top;
      if (rects.length === 1) {
        // One file: zoom in on it, as far as is comfortable (never past 1.1) and with room around it.
        const room = flowRef.current ?? { clientWidth: 1000, clientHeight: 700 };
        const zoom = Math.min(1.1, room.clientWidth / (width * 1.7), room.clientHeight / (height * 1.5));
        void setCenter(left + width / 2, top + height / 2, { zoom, duration: 700 });
      } else {
        // Several files: fit them all.
        void fitBounds({ x: left, y: top, width, height }, { duration: 700, padding: 0.2 });
      }
    },
    [fitBounds, setCenter, renderer, graph],
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
        lastEdited.current = file;
      }
      const go = () => moveTo(follow === 'all' ? editingNow.current : files);
      // A file in a collapsed folder has no card: open the folder, and move once the new layout is on screen.
      if (showFiles(files.filter((file) => ids.has(file)))) {
        pendingFollow.current = [...(follow === 'all' ? editingNow.current : files)].reverse(); // moveTo wants the newest last
        return;
      }
      // A placeholder card has to be on screen before the view can move to it.
      files.some((file) => !ids.has(file)) ? setTimeout(go, 100) : go();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [graph, follow, moveTo, showFiles]);

  // "Resume follow": go where the agent is. Files being written right now, or else the last one written.
  useEffect(() => {
    if (resumes === 0) {
      return;
    }
    const files = editingNow.current.length > 0 ? editingNow.current : lastEdited.current ? [lastEdited.current] : [];
    moveTo(files, true);
  }, [resumes]); // eslint-disable-line react-hooks/exhaustive-deps -- only a click on the button resumes

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

  // Go to a file picked in the sidebar once its card exists (its folder may have just been opened).
  useEffect(() => {
    const id = pendingFit.current;
    if (!id || !elements?.nodes.some((node) => node.id === id)) {
      return;
    }
    const timer = setTimeout(() => {
      pendingFit.current = undefined;
      void fitView({ nodes: [{ id }], duration: 400, maxZoom: 1, padding: 0.4 });
    }, 80);
    return () => clearTimeout(timer);
  }, [elements, fitView]);

  // Layout is asynchronous, so the cards appear a moment after the data arrives. The old layout
  // stays on screen while a new one is computed, so expanding a card does not blank the graph.
  useEffect(() => {
    let cancelled = false; // a newer request may arrive before this layout finishes
    renderer.layout(graph, shown, viewState).then(
      (result) => !cancelled && setElements(result),
      (error) => console.error('Layout failed', error),
    );
    return () => {
      cancelled = true;
    };
  }, [renderer, graph, shown, viewState]);

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
          // A file in a closed folder has no card yet: open the folder, and the camera follows once its layout is on screen.
          if (showFiles([id])) {
            pendingFit.current = renderer.nodeFor(graph, id);
          } else {
            void fitView({ nodes: [{ id: renderer.nodeFor(graph, id) }], duration: 400, maxZoom: 1, padding: 0.4 }); // bring the card into view
          }
          open(id);
        }}
        onHover={focus}
        onLeave={blur}
      />
      <div className="flow" ref={flowRef}>
        <ReactFlow
          nodes={[...view!.nodes, ...placeholders]}
          edges={view!.edges}
          nodeTypes={nodeTypes}
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
