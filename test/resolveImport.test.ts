import { describe, expect, it } from 'vitest';
import type { ResolveContext } from '../src/core/LanguageStrategy';
import { TypeScriptStrategy } from '../src/languages/typescript/TypeScriptStrategy';

const strategy = new TypeScriptStrategy();

/** An in-memory workspace: { "path": "file contents" }. */
function workspace(files: Record<string, string>): ResolveContext {
  return {
    fileExists: (path) => path in files,
    readFile: (path) => files[path],
  };
}

const resolve = (files: Record<string, string>, specifier: string, from = 'src/app/page.tsx') =>
  strategy.resolveImport(specifier, from, workspace(files));

describe('relative imports', () => {
  it('adds a missing extension', () => {
    expect(resolve({ 'src/app/utils.ts': '' }, './utils')).toBe('src/app/utils.ts');
    expect(resolve({ 'src/app/Card.tsx': '' }, './Card')).toBe('src/app/Card.tsx');
  });

  it('prefers .ts over .tsx over .js', () => {
    const files = { 'src/app/a.js': '', 'src/app/a.tsx': '', 'src/app/a.ts': '' };
    expect(resolve(files, './a')).toBe('src/app/a.ts');
  });

  it('goes up folders', () => {
    expect(resolve({ 'src/lib/db.ts': '' }, '../lib/db')).toBe('src/lib/db.ts');
  });

  it('finds index files for folder imports, with "." and ".." too', () => {
    expect(resolve({ 'src/app/ui/index.ts': '' }, './ui')).toBe('src/app/ui/index.ts');
    expect(resolve({ 'src/app/index.ts': '' }, '.')).toBe('src/app/index.ts');
    expect(resolve({ 'src/index.tsx': '' }, '..')).toBe('src/index.tsx');
  });

  it('prefers a file over a folder of the same name', () => {
    const files = { 'src/app/ui.ts': '', 'src/app/ui/index.ts': '' };
    expect(resolve(files, './ui')).toBe('src/app/ui.ts');
  });

  it('maps a compiled name (.js) to its source file', () => {
    expect(resolve({ 'src/app/a.ts': '' }, './a.js')).toBe('src/app/a.ts');
    expect(resolve({ 'src/app/a.tsx': '' }, './a.jsx')).toBe('src/app/a.tsx');
    expect(resolve({ 'src/app/a.js': '' }, './a.js')).toBe('src/app/a.js'); // a real .js file
  });

  it('keeps an explicit extension as written', () => {
    expect(resolve({ 'src/app/a.ts': '' }, './a.ts')).toBe('src/app/a.ts');
  });

  it('handles file names with dots', () => {
    expect(resolve({ 'src/app/site.config.ts': '' }, './site.config')).toBe('src/app/site.config.ts');
  });

  it('works for files in the workspace root', () => {
    expect(resolve({ 'next.config.ts': '' }, './next.config', 'index.ts')).toBe('next.config.ts');
  });

  it('ignores files that are not code, even if they exist', () => {
    expect(resolve({ 'src/app/styles.css': '', 'src/app/data.json': '' }, './styles.css')).toBeUndefined();
    expect(resolve({ 'src/app/data.json': '' }, './data.json')).toBeUndefined();
  });

  it('returns undefined for a missing file', () => {
    expect(resolve({}, './nope')).toBeUndefined();
  });

  it('does not escape the workspace', () => {
    expect(resolve({ 'x.ts': '' }, '../../../x', 'src/app/page.tsx')).toBeUndefined();
  });
});

describe('external packages', () => {
  it('returns undefined for npm packages and node built-ins', () => {
    const files = { 'tsconfig.json': '{}', 'react.ts': '' };
    expect(resolve(files, 'react')).toBeUndefined();
    expect(resolve(files, '@scope/pkg/sub')).toBeUndefined();
    expect(resolve(files, 'node:fs')).toBeUndefined();
    expect(resolve(files, 'https://example.com/x.js')).toBeUndefined();
  });
});

describe('tsconfig paths', () => {
  const next = {
    'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
    'src/lib/db.ts': '',
    'src/components/ui/button.tsx': '',
    'src/components/ui/index.ts': '',
  };

  it('resolves the Next.js "@/*" alias', () => {
    expect(resolve(next, '@/lib/db')).toBe('src/lib/db.ts');
    expect(resolve(next, '@/components/ui/button')).toBe('src/components/ui/button.tsx');
    expect(resolve(next, '@/components/ui')).toBe('src/components/ui/index.ts');
  });

  it('returns undefined when the alias target does not exist', () => {
    expect(resolve(next, '@/lib/missing')).toBeUndefined();
  });

  it('reads tsconfig with comments and trailing commas', () => {
    const files = {
      'tsconfig.json': `{
        // Next.js generated
        "compilerOptions": {
          /* aliases */
          "paths": { "@/*": ["./src/*"], },
        },
      }`,
      'src/lib/db.ts': '',
    };
    expect(resolve(files, '@/lib/db')).toBe('src/lib/db.ts');
  });

  it('measures paths from baseUrl when there is one', () => {
    const files = {
      'tsconfig.json': '{ "compilerOptions": { "baseUrl": "src", "paths": { "~/*": ["lib/*"] } } }',
      'src/lib/db.ts': '',
    };
    expect(resolve(files, '~/db')).toBe('src/lib/db.ts');
  });

  it('resolves bare imports from baseUrl', () => {
    const files = { 'tsconfig.json': '{ "compilerOptions": { "baseUrl": "src" } }', 'src/lib/db.ts': '' };
    expect(resolve(files, 'lib/db')).toBe('src/lib/db.ts');
  });

  it('prefers the longest matching pattern', () => {
    const files = {
      'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"], "@/ui/*": ["./packages/ui/*"] } } }',
      'src/ui/a.ts': '',
      'packages/ui/a.ts': '',
    };
    expect(resolve(files, '@/ui/a')).toBe('packages/ui/a.ts');
  });

  it('supports exact aliases and fallback targets', () => {
    const files = {
      'tsconfig.json': '{ "compilerOptions": { "paths": { "config": ["./generated/config", "./src/config"] } } }',
      'src/config.ts': '',
    };
    expect(resolve(files, 'config')).toBe('src/config.ts'); // first target missing, second exists
  });

  it('uses the nearest tsconfig in a monorepo', () => {
    const files = {
      'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./wrong/*"] } } }',
      'apps/web/tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
      'apps/web/src/lib/db.ts': '',
      'wrong/lib/db.ts': '',
    };
    expect(resolve(files, '@/lib/db', 'apps/web/src/app/page.tsx')).toBe('apps/web/src/lib/db.ts');
  });

  it('follows a relative "extends"', () => {
    const files = {
      'tsconfig.base.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
      'tsconfig.json': '{ "extends": "./tsconfig.base" }',
      'src/lib/db.ts': '',
    };
    expect(resolve(files, '@/lib/db')).toBe('src/lib/db.ts');
  });

  it('lets the child config override a parent alias', () => {
    const files = {
      'tsconfig.base.json': '{ "compilerOptions": { "paths": { "@/*": ["./base/*"] } } }',
      'apps/web/tsconfig.json':
        '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
      'apps/web/src/a.ts': '',
      'base/a.ts': '',
    };
    expect(resolve(files, '@/a', 'apps/web/page.tsx')).toBe('apps/web/src/a.ts');
  });

  it('uses jsconfig.json for JavaScript projects', () => {
    const files = {
      'jsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
      'src/lib/db.js': '',
    };
    expect(resolve(files, '@/lib/db')).toBe('src/lib/db.js');
  });

  it('survives a self-referencing extends and broken JSON', () => {
    const loop = { 'tsconfig.json': '{ "extends": "./tsconfig.json" }' };
    expect(resolve(loop, '@/x')).toBeUndefined();
    expect(resolve({ 'tsconfig.json': '{ not json' }, '@/x')).toBeUndefined();
  });
});
