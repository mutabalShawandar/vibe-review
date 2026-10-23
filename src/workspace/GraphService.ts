import { GitChangeProvider } from '../changes/GitChangeProvider';
import { buildGraph } from '../core/GraphBuilder';
import type { FrameworkRegistry } from '../core/FrameworkRegistry';
import type { StrategyRegistry } from '../core/StrategyRegistry';
import type { ChangeSet, GraphModel, GraphScope } from '../core/types';
import { describeUnsupported } from '../languages/unsupported';
import type { ParserLoader } from '../parser/ParserLoader';
import { WorkspaceAnalyzer, type AnalysisResult } from './WorkspaceAnalyzer';

export interface WorkspaceGraph {
  graph: GraphModel;
  /** How many files git reports as changed (including ones we do not analyze, like .md). */
  changeCount: number;
  /** The git changes the graph was built from; the editor highlights use their line ranges. */
  changes: ChangeSet;
  analysis: AnalysisResult;
}

/**
 * The whole pipeline in one call: scan the workspace, read git changes, build the graph.
 * Keeps one analyzer per workspace folder so its cache survives between calls.
 */
export class GraphService {
  private readonly analyzers = new Map<string, WorkspaceAnalyzer>();

  constructor(
    private readonly registry: StrategyRegistry,
    private readonly parser: ParserLoader,
    private readonly frameworks?: FrameworkRegistry,
  ) {}

  /** Whether a language strategy handles this file, i.e. whether it can ever appear in the diagram. */
  canAnalyze(file: string): boolean {
    return this.registry.forFile(file) !== undefined;
  }

  async build(
    root: string,
    scope: GraphScope,
    onProgress?: (done: number, total: number) => void,
  ): Promise<WorkspaceGraph> {
    let analyzer = this.analyzers.get(root);
    if (!analyzer) {
      analyzer = new WorkspaceAnalyzer(root, this.registry, this.parser, this.frameworks);
      this.analyzers.set(root, analyzer);
    }

    const analysis = await analyzer.analyze(onProgress);
    const changes = await new GitChangeProvider(root).getChanges();
    const graph = buildGraph(analysis.files, changes, scope);
    // Languages without a strategy are not in the diagram; say so instead of leaving the reviewer guessing.
    const unsupported = describeUnsupported(
      analysis.otherFiles,
      changes.map((change) => change.path),
    );
    return {
      graph: unsupported.length > 0 ? { ...graph, unsupported } : graph,
      changeCount: changes.length,
      changes,
      analysis,
    };
  }
}
