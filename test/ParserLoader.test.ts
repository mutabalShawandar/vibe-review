import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ParserLoader } from '../src/parser/ParserLoader';

// In tests the .wasm files are read straight from node_modules (no build step needed).
const nodeModules = path.resolve(__dirname, '../node_modules');
const resolveWasm = (name: string) =>
  name === 'tree-sitter.wasm'
    ? path.join(nodeModules, 'web-tree-sitter', name)
    : path.join(nodeModules, 'tree-sitter-wasms', 'out', name);

describe('ParserLoader', () => {
  const loader = new ParserLoader(resolveWasm);

  it('parses TypeScript', async () => {
    const tree = await loader.parse('tree-sitter-typescript.wasm', 'export class A {}');
    expect(tree.rootNode.type).toBe('program');
    expect(tree.rootNode.hasError).toBe(false);
  });

  it('parses TSX', async () => {
    const tree = await loader.parse('tree-sitter-tsx.wasm', 'const x = <div>hi</div>;');
    expect(tree.rootNode.hasError).toBe(false);
  });

  it('parses Python', async () => {
    const tree = await loader.parse('tree-sitter-python.wasm', 'class A:\n  pass\n');
    expect(tree.rootNode.type).toBe('module');
  });

  it('flags syntax errors instead of throwing', async () => {
    const tree = await loader.parse('tree-sitter-typescript.wasm', 'class {{{');
    expect(tree.rootNode.hasError).toBe(true);
  });
});

describe('ParserLoader failure handling', () => {
  it('retries a grammar after a failed load instead of caching the failure', async () => {
    let failNext = true;
    const flaky = new ParserLoader((name) => {
      if (name === 'tree-sitter-python.wasm' && failNext) {
        failNext = false;
        return path.join(nodeModules, 'does-not-exist.wasm'); // first attempt: file missing
      }
      return resolveWasm(name);
    });

    await expect(flaky.parse('tree-sitter-python.wasm', 'x = 1\n')).rejects.toThrow();
    const tree = await flaky.parse('tree-sitter-python.wasm', 'x = 1\n');
    expect(tree.rootNode.type).toBe('module');
  });
});
