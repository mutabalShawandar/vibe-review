import type { FileRole, FrameworkStrategy } from '../../core/FrameworkStrategy';
import type { ResolveContext } from '../../core/LanguageStrategy';

// Folder names that almost every JavaScript or TypeScript project uses the same way.
// The folder closest to the file wins, so `app/users/components/Table.tsx` is "ui", not a page.
const FOLDER_ROLES: Record<string, FileRole> = {
  components: 'ui',
  component: 'ui',
  ui: 'ui',
  widgets: 'ui',
  hooks: 'hook',
  pages: 'page',
  screens: 'page',
  views: 'page',
  routes: 'api',
  api: 'api',
  controllers: 'api',
  middleware: 'api',
  types: 'types',
  '@types': 'types',
  lib: 'lib',
  utils: 'lib',
  util: 'lib',
  helpers: 'lib',
  services: 'lib',
  store: 'lib',
  stores: 'lib',
  state: 'lib',
  db: 'lib',
  data: 'lib',
  models: 'lib',
  __tests__: 'test',
  tests: 'test',
  test: 'test',
};

/** The role a file name alone gives away: tests, type declarations, `useSomething` hooks. */
function roleFromFileName(fileName: string): FileRole | undefined {
  if (/\.(test|spec)\.[a-z]+$/i.test(fileName)) {
    return 'test';
  }
  if (/\.d\.[cm]?ts$/i.test(fileName)) {
    return 'types';
  }
  if (/^use[A-Z0-9][^.]*\.[a-z]+$/.test(fileName)) {
    return 'hook';
  }
  return undefined;
}

/**
 * The conventions shared by React, Next.js, Vite and Node projects: `components/` is UI, `hooks/`
 * are hooks, `lib/` and `utils/` are logic. It matches every workspace, so register it last; the
 * more specific frameworks are tried first and fall back to it for anything they do not know.
 */
export class GenericStrategy implements FrameworkStrategy {
  readonly id = 'generic';
  readonly name = 'JavaScript project';

  detect(_ctx: ResolveContext): boolean {
    return true;
  }

  roleOf(path: string): FileRole | undefined {
    const segments = path.replace(/\\/g, '/').split('/');
    const fileName = segments.pop() ?? '';

    const fromName = roleFromFileName(fileName);
    if (fromName) {
      return fromName;
    }
    for (let i = segments.length - 1; i >= 0; i--) {
      const role = FOLDER_ROLES[segments[i]!.toLowerCase()];
      if (role) {
        return role;
      }
    }
    return undefined;
  }
}
