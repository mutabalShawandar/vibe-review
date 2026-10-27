import type { FrameworkStrategy } from '../../core/FrameworkStrategy';
import type { ResolveContext } from '../../core/LanguageStrategy';

const CODE = '(?:tsx?|jsx?|mjs|cjs|mts|cts)';

// App Router: files with a reserved name inside app/ (or src/app/), at any depth.
const APP_FILE = new RegExp(`^(?:src/)?app/(?:.+/)?([^/]+)\\.${CODE}$`, 'i');
const APP_LABELS: Record<string, string> = {
  page: 'Next.js page',
  layout: 'Next.js layout',
  route: 'Next.js route handler',
  loading: 'Next.js loading UI',
  error: 'Next.js error boundary',
  'global-error': 'Next.js error boundary',
  'not-found': 'Next.js not-found page',
  template: 'Next.js template',
  default: 'Next.js parallel route fallback',
};

// Pages Router: every file inside pages/ (or src/pages/) is a route, except the _app/_document/_error wrappers.
const PAGES_FILE = new RegExp(`^(?:src/)?pages/(.+)\\.${CODE}$`, 'i');
const PAGES_SPECIAL: Record<string, string> = {
  _app: 'Next.js app wrapper',
  _document: 'Next.js document',
  _error: 'Next.js error page',
};

// Single files at the project root (or in src/). `proxy` is the Next.js 16 name for `middleware`.
const ROOT_FILE = new RegExp(`^(?:src/)?(middleware|proxy|instrumentation)\\.${CODE}$`, 'i');
const ROOT_LABELS: Record<string, string> = {
  middleware: 'Next.js middleware',
  proxy: 'Next.js proxy',
  instrumentation: 'Next.js instrumentation',
};

const CONFIG_FILE = /^next\.config\.(?:js|mjs|cjs|ts|mts)$/i;

/** Next.js, both the App Router (app/) and the Pages Router (pages/). */
export class NextJsStrategy implements FrameworkStrategy {
  readonly id = 'nextjs';

  detect(ctx: ResolveContext, files: readonly string[]): string[] {
    const roots: string[] = [];
    for (const file of files) {
      if (file !== 'package.json' && !file.endsWith('/package.json')) {
        continue;
      }
      if (dependsOnNext(ctx.readFile(file))) {
        roots.push(file === 'package.json' ? '' : file.slice(0, -'/package.json'.length));
      }
    }
    return roots;
  }

  entryPoint(path: string): string | undefined {
    const app = APP_FILE.exec(path);
    if (app) {
      return APP_LABELS[app[1].toLowerCase()];
    }

    const pages = PAGES_FILE.exec(path);
    if (pages) {
      const route = pages[1];
      if (route === 'api' || route.startsWith('api/')) {
        return 'Next.js API route';
      }
      return PAGES_SPECIAL[route.toLowerCase()] ?? 'Next.js page';
    }

    const single = ROOT_FILE.exec(path);
    if (single) {
      return ROOT_LABELS[single[1].toLowerCase()];
    }
    return CONFIG_FILE.test(path) ? 'Next.js config' : undefined;
  }
}

/** True when a package.json lists `next` as a dependency of any kind. Unreadable or invalid JSON counts as no. */
function dependsOnNext(packageJson: string | undefined): boolean {
  if (!packageJson) {
    return false;
  }
  try {
    const parsed = JSON.parse(packageJson) as Record<string, unknown>;
    return ['dependencies', 'devDependencies', 'peerDependencies'].some((key) => {
      const group = parsed[key];
      return typeof group === 'object' && group !== null && 'next' in group;
    });
  } catch {
    return false;
  }
}
