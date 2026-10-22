import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Debouncer } from '../src/workspace/Debouncer';
import { isRelevantChange } from '../src/workspace/ignoredPaths';

describe('Debouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs once after a burst of triggers', () => {
    const run = vi.fn();
    const debouncer = new Debouncer(run, 500, 3000);
    for (let i = 0; i < 5; i++) {
      debouncer.trigger();
      vi.advanceTimersByTime(200); // each trigger arrives before the previous wait is over
    }
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('still runs during a burst that never goes quiet', () => {
    const run = vi.fn();
    const debouncer = new Debouncer(run, 500, 2000);
    for (let i = 0; i < 30; i++) {
      debouncer.trigger();
      vi.advanceTimersByTime(200); // 6 seconds of constant edits
    }
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not run after dispose', () => {
    const run = vi.fn();
    const debouncer = new Debouncer(run, 500, 3000);
    debouncer.trigger();
    debouncer.dispose();
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('isRelevantChange', () => {
  it('ignores dependencies, build output and caches', () => {
    expect(isRelevantChange('node_modules/react/index.js')).toBe(false);
    expect(isRelevantChange('apps/web/.next/server/page.js')).toBe(false);
    expect(isRelevantChange('dist/extension.js')).toBe(false);
    expect(isRelevantChange('.git/objects/ab/cdef')).toBe(false);
  });

  it('keeps source files and the git files that move the baseline', () => {
    expect(isRelevantChange('src/app/page.tsx')).toBe(true);
    expect(isRelevantChange('src\\core\\types.ts')).toBe(true);
    expect(isRelevantChange('.git/HEAD')).toBe(true);
    expect(isRelevantChange('.git/index')).toBe(true);
  });
});
