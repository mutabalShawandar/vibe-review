import { describe, expect, it } from 'vitest';
import { describeUnsupported } from '../src/languages/unsupported';

describe('describeUnsupported', () => {
  it('counts files by language and names the changed ones', () => {
    const result = describeUnsupported(
      ['api/main.py', 'api/models.py', 'api/routes/users.py', 'cmd/server.go', 'README.md', 'logo.png'],
      ['api/models.py', 'README.md'],
    );
    expect(result).toEqual([
      { language: 'Python', files: 3, changed: ['api/models.py'] },
      { language: 'Go', files: 1, changed: [] },
    ]);
  });

  it('puts languages with changes first, then the larger ones', () => {
    const result = describeUnsupported(['a.go', 'b.go', 'c.go', 'a.rb', 'a.rs'], ['a.rs']);
    expect(result.map((entry) => entry.language)).toEqual(['Rust', 'Go', 'Ruby']);
  });

  it('counts a changed file that no longer exists', () => {
    expect(describeUnsupported([], ['old/removed.py'])).toEqual([{ language: 'Python', files: 1, changed: ['old/removed.py'] }]);
  });

  it('ignores data, docs, assets and files without an extension', () => {
    expect(describeUnsupported(['package.json', 'Makefile', 'style.css', 'notes.md', 'LICENSE'], ['Makefile'])).toEqual([]);
  });

  it('matches extensions in any case and merges aliases of one language', () => {
    expect(describeUnsupported(['A.PY', 'types.pyi'], [])).toEqual([{ language: 'Python', files: 2, changed: [] }]);
  });

  it('lists each changed file once, sorted', () => {
    const result = describeUnsupported(['b.py', 'a.py'], ['b.py', 'a.py', 'b.py']);
    expect(result[0]!.changed).toEqual(['a.py', 'b.py']);
    expect(result[0]!.files).toBe(2);
  });
});
