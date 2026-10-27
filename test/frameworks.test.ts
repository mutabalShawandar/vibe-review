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

    const classify = registry.classifier(ctx, list);

    expect(classify('web/app/page.tsx')?.entryPoint).toBe('Next.js page');
    expect(classify('server/app/page.tsx')?.entryPoint).toBeUndefined(); // outside the Next.js project
  });

  it('lets the deepest project decide and falls through to the next framework in the same folder', () => {
    const outer: FrameworkStrategy = { id: 'outer', detect: () => [''], entryPoint: () => 'outer' };
    const inner: FrameworkStrategy = { id: 'inner', detect: () => ['pkg'], entryPoint: (p) => (p === 'a.ts' ? 'inner' : undefined) };
    const sibling: FrameworkStrategy = { id: 'sibling', detect: () => ['pkg'], entryPoint: (p) => (p === 'b.ts' ? 'sibling' : undefined) };
    const registry = new FrameworkRegistry();
    [outer, inner, sibling].forEach((s) => registry.register(s));

    const classify = registry.classifier({ fileExists: () => false, readFile: () => undefined }, []);

    expect(classify('pkg/a.ts')?.entryPoint).toBe('inner');
    expect(classify('pkg/b.ts')?.entryPoint).toBe('sibling');
    expect(classify('pkg/c.ts')?.entryPoint).toBeUndefined(); // the outer project does not reach into the inner one
    expect(classify('other.ts')?.entryPoint).toBe('outer');
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
    const classify = registry.classifier({ fileExists: () => false, readFile: () => undefined }, []);
    expect(classify('webapp/x.ts')?.entryPoint).toBeUndefined();
  });
});

describe('NextJsStrategy.role', () => {
  const role = (path: string) => new NextJsStrategy().role(path);

  it.each([
    ['app/page.tsx', 'page'],
    ['pages/index.tsx', 'page'],
    ['app/layout.tsx', 'layout'],
    ['app/users/template.tsx', 'layout'],
    ['pages/_app.tsx', 'layout'],
    ['pages/_document.tsx', 'layout'],
    ['app/api/users/route.ts', 'api'],
    ['pages/api/users.ts', 'api'],
    ['app/loading.tsx', 'boundary'],
    ['app/error.tsx', 'boundary'],
    ['app/not-found.tsx', 'boundary'],
    ['app/@modal/default.tsx', 'boundary'],
    ['middleware.ts', 'middleware'],
    ['proxy.ts', 'middleware'],
    ['instrumentation.ts', 'middleware'],
    ['next.config.mjs', 'config'],
  ])('%s is a %s', (path, expected) => {
    expect(role(path)).toBe(expected);
  });

  it('has no role for an ordinary file', () => {
    expect(role('lib/db.ts')).toBeUndefined();
    expect(role('app/components/Button.tsx')).toBeUndefined();
  });

  it('gives every label the strategy can produce a role', () => {
    const paths = [
      'app/page.tsx', 'app/layout.tsx', 'app/api/x/route.ts', 'app/loading.tsx', 'app/error.tsx', 'app/global-error.tsx',
      'app/not-found.tsx', 'app/template.tsx', 'app/@s/default.tsx', 'pages/a.tsx', 'pages/api/a.ts', 'pages/_app.tsx',
      'pages/_document.tsx', 'pages/_error.tsx', 'middleware.ts', 'proxy.ts', 'instrumentation.ts', 'next.config.ts',
    ];
    for (const path of paths) {
      expect(new NextJsStrategy().entryPoint(path), path).toBeDefined();
      expect(role(path), `${path} has a label but no role`).toBeDefined();
    }
  });
});

describe('NextJsStrategy.route', () => {
  const route = (path: string) => new NextJsStrategy().route(path);

  it.each([
    ['app/page.tsx', '/'],
    ['app/layout.tsx', '/'],
    ['src/app/users/page.tsx', '/users'],
    ['app/users/[id]/page.tsx', '/users/[id]'],
    ['app/users/[id]/loading.tsx', '/users/[id]'],
    ['app/api/users/route.ts', '/api/users'],
    ['app/docs/[...slug]/page.tsx', '/docs/[...slug]'],
    ['app/(shop)/cart/page.tsx', '/cart'], // a route group is not part of the URL
    ['app/(shop)/(promo)/sale/page.tsx', '/sale'],
    ['app/@modal/photo/page.tsx', '/photo'], // a parallel-route slot is not either
    ['app/(.)photo/page.tsx', '/photo'], // an intercepting route keeps the name it intercepts
    ['pages/index.tsx', '/'],
    ['pages/users/index.tsx', '/users'],
    ['pages/users/[id].tsx', '/users/[id]'],
    ['pages/api/users.ts', '/api/users'],
  ])('%s is %s', (path, expected) => {
    expect(route(path)).toBe(expected);
  });

  it.each([
    'app/components/Button.tsx', // not a special file
    'app/_lib/page.tsx', // a private folder is not a route
    'app/users/_components/page.tsx',
    'pages/_app.tsx',
    'pages/_document.tsx',
    'middleware.ts',
    'lib/db.ts',
  ])('%s has no route', (path) => {
    expect(route(path)).toBeUndefined();
  });
});

describe('FrameworkRegistry classification', () => {
  it('reports the label, the route and the project folder of a file', () => {
    const registry = new FrameworkRegistry();
    registry.register(new NextJsStrategy());
    const { ctx, list } = workspace({ 'apps/web/package.json': next });

    const classify = registry.classifier(ctx, list);

    expect(classify('apps/web/app/users/[id]/page.tsx')).toEqual({
      entryPoint: 'Next.js page',
      role: 'page',
      route: '/users/[id]',
      project: 'apps/web',
    });
    // labeled, but not a route
    expect(classify('apps/web/middleware.ts')).toEqual({ entryPoint: 'Next.js middleware', role: 'middleware', project: 'apps/web' });
    expect(classify('apps/web/lib/db.ts')).toBeUndefined();
  });
});
