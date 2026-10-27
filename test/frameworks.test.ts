import { describe, expect, it } from 'vitest';
import { FrameworkRegistry } from '../src/core/FrameworkRegistry';
import type { FrameworkStrategy } from '../src/core/FrameworkStrategy';
import type { ResolveContext } from '../src/core/LanguageStrategy';
import { NextJsStrategy } from '../src/frameworks/nextjs/NextJsStrategy';

/** An in-memory workspace: path -> content. */
const workspace = (files: Record<string, string>): { ctx: ResolveContext; list: string[] } => ({
  ctx: { fileExists: (p) => p in files, readFile: (p) => files[p] },
  list: Object.keys(files),
});

const next = JSON.stringify({ dependencies: { next: '15.0.0' } });

describe('NextJsStrategy.detect', () => {
  const strategy = new NextJsStrategy();

  it('finds a project at the workspace root', () => {
    const { ctx, list } = workspace({ 'package.json': next });
    expect(strategy.detect(ctx, list)).toEqual(['']);
  });

  it('finds projects in a monorepo and ignores packages without next', () => {
    const { ctx, list } = workspace({
      'package.json': '{}',
      'apps/web/package.json': JSON.stringify({ devDependencies: { next: '15' } }),
      'apps/api/package.json': JSON.stringify({ dependencies: { express: '4' } }),
    });
    expect(strategy.detect(ctx, list)).toEqual(['apps/web']);
  });

  it('survives invalid or missing package.json content', () => {
    const { ctx, list } = workspace({ 'package.json': '{ not json' });
    expect(strategy.detect(ctx, list)).toEqual([]);
    expect(strategy.detect({ fileExists: () => true, readFile: () => undefined }, ['package.json'])).toEqual([]);
  });
});

describe('NextJsStrategy.entryPoint', () => {
  const label = (path: string) => new NextJsStrategy().entryPoint(path);

  it.each([
    ['app/page.tsx', 'Next.js page'],
    ['src/app/users/[id]/page.tsx', 'Next.js page'],
    ['app/layout.tsx', 'Next.js layout'],
    ['app/api/users/route.ts', 'Next.js route handler'],
    ['app/loading.tsx', 'Next.js loading UI'],
    ['app/error.tsx', 'Next.js error boundary'],
    ['app/not-found.tsx', 'Next.js not-found page'],
    ['pages/index.tsx', 'Next.js page'],
    ['pages/api/users.ts', 'Next.js API route'],
    ['src/pages/api/users/[id].ts', 'Next.js API route'],
    ['pages/_app.tsx', 'Next.js app wrapper'],
    ['pages/_document.tsx', 'Next.js document'],
    ['middleware.ts', 'Next.js middleware'],
    ['src/middleware.ts', 'Next.js middleware'],
    ['proxy.ts', 'Next.js proxy'],
    ['instrumentation.ts', 'Next.js instrumentation'],
    ['next.config.mjs', 'Next.js config'],
  ])('%s is a %s', (path, expected) => {
    expect(label(path)).toBe(expected);
  });

  it.each(['app/components/Button.tsx', 'lib/page.ts', 'src/utils/route.ts', 'app/page.css', 'components/layout.tsx'])(
    '%s is an ordinary file',
    (path) => {
      expect(label(path)).toBeUndefined();
    },
  );
});

describe('FrameworkRegistry', () => {
  it('labels files relative to each project folder', () => {
    const registry = new FrameworkRegistry();
    registry.register(new NextJsStrategy());
    const { ctx, list } = workspace({ 'web/package.json': next, 'web/app/page.tsx': '', 'server/app/page.tsx': '' });

    const label = registry.labeler(ctx, list);

    expect(label('web/app/page.tsx')).toBe('Next.js page');
    expect(label('server/app/page.tsx')).toBeUndefined(); // outside the Next.js project
  });

  it('lets the deepest project decide and falls through to the next framework in the same folder', () => {
    const outer: FrameworkStrategy = { id: 'outer', detect: () => [''], entryPoint: () => 'outer' };
    const inner: FrameworkStrategy = { id: 'inner', detect: () => ['pkg'], entryPoint: (p) => (p === 'a.ts' ? 'inner' : undefined) };
    const sibling: FrameworkStrategy = { id: 'sibling', detect: () => ['pkg'], entryPoint: (p) => (p === 'b.ts' ? 'sibling' : undefined) };
    const registry = new FrameworkRegistry();
    [outer, inner, sibling].forEach((s) => registry.register(s));

    const label = registry.labeler({ fileExists: () => false, readFile: () => undefined }, []);

    expect(label('pkg/a.ts')).toBe('inner');
    expect(label('pkg/b.ts')).toBe('sibling');
    expect(label('pkg/c.ts')).toBeUndefined(); // the outer project does not reach into the inner one
    expect(label('other.ts')).toBe('outer');
  });

  it('rejects a duplicate id', () => {
    const registry = new FrameworkRegistry();
    registry.register(new NextJsStrategy());
    expect(() => registry.register(new NextJsStrategy())).toThrow(/already registered/);
  });

  it('does not treat "webapp/x" as inside "web"', () => {
    const web: FrameworkStrategy = { id: 'web', detect: () => ['web'], entryPoint: () => 'web' };
    const registry = new FrameworkRegistry();
    registry.register(web);
    const label = registry.labeler({ fileExists: () => false, readFile: () => undefined }, []);
    expect(label('webapp/x.ts')).toBeUndefined();
  });
});
