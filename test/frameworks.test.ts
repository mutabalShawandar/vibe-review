import { describe, expect, it } from 'vitest';
import type { ResolveContext } from '../src/core/LanguageStrategy';
import { createFrameworkRegistry } from '../src/frameworks';
import { GenericStrategy } from '../src/frameworks/generic/GenericStrategy';
import { NextJsStrategy } from '../src/frameworks/nextjs/NextJsStrategy';

/** An in-memory workspace: { "path": "file contents" }. */
function workspace(files: Record<string, string>): ResolveContext {
  return { fileExists: (path) => path in files, readFile: (path) => files[path] };
}

const registry = createFrameworkRegistry();
const nextProject = workspace({ 'package.json': JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' } }) });
const viteProject = workspace({ 'package.json': JSON.stringify({ dependencies: { react: '19.0.0' } }) });

describe('detecting the framework', () => {
  it('finds Next.js from package.json, in dependencies or devDependencies', () => {
    expect(registry.detect(nextProject)?.id).toBe('nextjs');
    expect(registry.detect(workspace({ 'package.json': '{"devDependencies":{"next":"14"}}' }))?.id).toBe('nextjs');
  });

  it('finds Next.js from its config file when package.json says nothing', () => {
    expect(registry.detect(workspace({ 'next.config.mjs': '' }))?.id).toBe('nextjs');
  });

  it('falls back to the generic conventions for anything else', () => {
    expect(registry.detect(viteProject)?.id).toBe('generic');
    expect(registry.detect(workspace({}))?.id).toBe('generic');
  });

  it('does not guess from a package.json that is not valid JSON', () => {
    expect(registry.detect(workspace({ 'package.json': '{ not json' }))?.id).toBe('generic');
  });

  it('refuses to register the same id twice', () => {
    const duplicate = createFrameworkRegistry();
    expect(() => duplicate.register(new NextJsStrategy())).toThrow(/already registered/);
  });
});

describe('generic roles', () => {
  const role = (path: string) => new GenericStrategy().roleOf(path);

  it('reads the common folder names', () => {
    expect(role('src/components/Button.tsx')).toBe('ui');
    expect(role('src/hooks/useUser.ts')).toBe('hook');
    expect(role('src/lib/db.ts')).toBe('lib');
    expect(role('src/utils/format.ts')).toBe('lib');
    expect(role('src/services/users.ts')).toBe('lib');
    expect(role('src/types/user.ts')).toBe('types');
    expect(role('src/pages/Home.tsx')).toBe('page');
    expect(role('src/routes/users.ts')).toBe('api');
  });

  it('lets the folder closest to the file win', () => {
    expect(role('src/pages/users/components/Table.tsx')).toBe('ui');
    expect(role('src/components/hooks/useToggle.ts')).toBe('hook');
  });

  it('reads the file name before the folders', () => {
    expect(role('src/components/Button.test.tsx')).toBe('test');
    expect(role('src/lib/useDebounce.ts')).toBe('hook');
    expect(role('src/lib/globals.d.ts')).toBe('types');
  });

  it('has no opinion about a file it does not recognize', () => {
    expect(role('src/index.ts')).toBeUndefined();
    expect(role('scripts/build.mjs')).toBeUndefined();
  });

  it('is not fooled by a name that merely starts with "use"', () => {
    expect(role('src/lib/user.ts')).toBe('lib');
    expect(role('src/misc/usefulThing.ts')).toBeUndefined();
  });

  it('accepts Windows separators and any case in folder names', () => {
    expect(role('src\\Components\\Button.tsx')).toBe('ui');
  });
});

describe('Next.js App Router', () => {
  const next = new NextJsStrategy();

  it('knows the reserved files', () => {
    expect(next.roleOf('src/app/users/page.tsx')).toBe('page');
    expect(next.entryPoint('src/app/users/page.tsx')).toBe('Next.js page');
    expect(next.entryPoint('app/layout.tsx')).toBe('Next.js layout');
    expect(next.entryPoint('app/(shop)/cart/loading.tsx')).toBe('Next.js loading UI');
    expect(next.roleOf('app/api/users/route.ts')).toBe('api');
    expect(next.entryPoint('app/api/users/route.ts')).toBe('Next.js route handler');
  });

  it('knows middleware only at the root of the source', () => {
    expect(next.entryPoint('src/middleware.ts')).toBe('Next.js middleware');
    expect(next.entryPoint('middleware.ts')).toBe('Next.js middleware');
    expect(next.entryPoint('src/lib/middleware.ts')).toBeUndefined();
  });

  it('has no opinion about other files inside app/', () => {
    expect(next.roleOf('src/app/users/UserTable.tsx')).toBeUndefined();
    expect(next.roleOf('src/app/users/page.module.css')).toBeUndefined();
  });
});

describe('Next.js Pages Router', () => {
  const next = new NextJsStrategy();

  it('treats files in pages/ as pages and pages/api/ as endpoints', () => {
    expect(next.entryPoint('pages/index.tsx')).toBe('Next.js page');
    expect(next.entryPoint('src/pages/users/[id].tsx')).toBe('Next.js page');
    expect(next.roleOf('pages/api/users.ts')).toBe('api');
    expect(next.entryPoint('pages/api/users.ts')).toBe('Next.js API route');
    expect(next.entryPoint('pages/_app.tsx')).toBe('Next.js app wrapper');
  });
});

describe('roles through the registry', () => {
  it('uses the framework first and the generic conventions after it', () => {
    const next = registry.forId('nextjs')!;
    expect(registry.roleOf(next, 'src/app/users/page.tsx')).toBe('page');
    expect(registry.roleOf(next, 'src/components/Button.tsx')).toBe('ui');
    expect(registry.roleOf(next, 'src/index.ts')).toBe('other');
  });

  it('gives the generic role to a project without a framework', () => {
    const generic = registry.forId('generic')!;
    expect(registry.roleOf(generic, 'src/hooks/useUser.ts')).toBe('hook');
    // Without Next.js, `app/users/page.tsx` is just a file in a folder called app.
    expect(registry.roleOf(generic, 'src/app/users/page.tsx')).toBe('other');
  });
});
