import type { FileRole, FrameworkStrategy } from '../../core/FrameworkStrategy';
import type { ResolveContext } from '../../core/LanguageStrategy';

const SOURCE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/i;

// App Router: files with a reserved name inside `app/` are what Next.js itself calls.
const APP_FILES: Record<string, { role: FileRole; label: string }> = {
  page: { role: 'page', label: 'Next.js page' },
  layout: { role: 'page', label: 'Next.js layout' },
  template: { role: 'page', label: 'Next.js template' },
  loading: { role: 'page', label: 'Next.js loading UI' },
  error: { role: 'page', label: 'Next.js error UI' },
  'global-error': { role: 'page', label: 'Next.js error UI' },
  'not-found': { role: 'page', label: 'Next.js not-found page' },
  default: { role: 'page', label: 'Next.js parallel route default' },
  route: { role: 'api', label: 'Next.js route handler' },
};

interface NextFile {
  role: FileRole;
  label: string;
}

/** What Next.js makes of a file from its path alone, or undefined for a file it does not treat specially. */
function nextFileOf(path: string): NextFile | undefined {
  const segments = path.replace(/\\/g, '/').split('/');
  const fileName = segments.pop() ?? '';
  if (!SOURCE_FILE.test(fileName)) {
    return undefined;
  }
  const name = fileName.replace(SOURCE_FILE, '');
  // Both layouts of a project: `app/` or `src/app/` (same for `pages/`).
  const root = segments[0] === 'src' ? segments.slice(1) : segments;

  if (name === 'middleware' && root.length === 0) {
    return { role: 'api', label: 'Next.js middleware' };
  }
  if (root[0] === 'app') {
    return APP_FILES[name];
  }
  if (root[0] === 'pages') {
    if (root[1] === 'api') {
      return { role: 'api', label: 'Next.js API route' };
    }
    if (root.length === 1 && name === '_app') {
      return { role: 'page', label: 'Next.js app wrapper' };
    }
    if (root.length === 1 && name === '_document') {
      return { role: 'page', label: 'Next.js document' };
    }
    return { role: 'page', label: 'Next.js page' };
  }
  return undefined;
}

/**
 * Next.js, both the App Router (`app/`) and the Pages Router (`pages/`). It knows the files whose
 * name or place gives them a job; everything else (components/, hooks/, lib/...) is left to the
 * generic conventions.
 */
export class NextJsStrategy implements FrameworkStrategy {
  readonly id = 'nextjs';
  readonly name = 'Next.js';

  detect(ctx: ResolveContext): boolean {
    if (['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts'].some((file) => ctx.fileExists(file))) {
      return true;
    }
    const manifest = ctx.readFile('package.json');
    if (!manifest) {
      return false;
    }
    try {
      const { dependencies, devDependencies } = JSON.parse(manifest) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return Boolean(dependencies?.next ?? devDependencies?.next);
    } catch {
      return false; // a package.json that does not parse is not a reason to guess
    }
  }

  roleOf(path: string): FileRole | undefined {
    return nextFileOf(path)?.role;
  }

  entryPoint(path: string): string | undefined {
    return nextFileOf(path)?.label;
  }
}
