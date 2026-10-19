import type { FileChange, LineRange } from '../core/types';

// `@@ -12,3 +14,5 @@` means: old file lines 12-14 were replaced by new file lines 14-18.
// We only care about the "+" side (the new version), because that is what the reviewer reads.
// Capture groups: 1 = new start line, 2 = new line count (omitted by git when it is 1).
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

// A path that git wrapped in double quotes because it contains a tab, newline, quote,
// backslash or non-ASCII bytes, e.g. "a/caf\303\251.ts". Inner quotes are backslash-escaped.
// core.quotepath=false does NOT stop this for control characters, quotes and backslashes.
const QUOTED = String.raw`"(?:[^"\\]|\\.)*"`;

// First line of every file section. Each of the two paths is quoted independently, so
// there are three shapes to recognise. Capture group 1 is the NEW path, with its "b/" prefix.
// Only used for the path of files that have no ---/+++ lines (binary files); the ---/+++
// lines override it when present.
const DIFF_HEADERS = [
  new RegExp(String.raw`^diff --git (?:${QUOTED}|a/.+?) (${QUOTED})$`), // new path quoted
  new RegExp(String.raw`^diff --git ${QUOTED} (b/.+)$`), // only the old path quoted
  /^diff --git a\/.+ (b\/.+)$/, // nothing quoted
];

/**
 * Turn the text output of `git diff -U0` into a list of changed files with line ranges.
 * This is a pure function (text in, data out) so it can be unit tested without git.
 */
export function parseUnifiedDiff(diff: string): FileChange[] {
  const changes: FileChange[] = [];

  // The file section we are currently reading. Pushed to `changes` when the next section starts.
  let current: FileChange | undefined;

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      // A new file section begins. Assume "modified" until a later line says otherwise.
      current = { path: pathFromDiffHeader(line) ?? '', kind: 'modified', ranges: [] };
      changes.push(current);
      continue;
    }
    if (!current) {
      continue; // text before the first file section; nothing to read
    }

    if (line.startsWith('new file mode')) {
      current.kind = 'added';
    } else if (line.startsWith('deleted file mode')) {
      current.kind = 'deleted';
    } else if (line.startsWith('--- ') && current.kind === 'deleted') {
      // A deleted file's new side is /dev/null, so its real path is on the "---" line.
      current.path = pathFromMarkerLine(line, 'a') ?? current.path;
    } else if (line.startsWith('+++ ')) {
      // The "+++" line is the most reliable path (it handles renames). For "+++ /dev/null"
      // this returns undefined and the path from the header is kept.
      current.path = pathFromMarkerLine(line, 'b') ?? current.path;
    } else {
      const hunk = HUNK_HEADER.exec(line);
      if (hunk) {
        const range = toRange(Number(hunk[1]), hunk[2] === undefined ? 1 : Number(hunk[2]));
        current.ranges.push(range);
      }
    }
  }

  // Drop sections whose path could not be read rather than reporting an empty path.
  return changes.filter((change) => change.path !== '');
}

function pathFromDiffHeader(line: string): string | undefined {
  for (const pattern of DIFF_HEADERS) {
    const match = pattern.exec(line);
    if (match) {
      return stripSidePrefix(decodeGitPath(match[1]), 'b');
    }
  }
  return undefined;
}

/** Read the path from a `--- a/x` or `+++ b/x` line, quoted or not. Undefined for /dev/null. */
function pathFromMarkerLine(line: string, side: 'a' | 'b'): string | undefined {
  // Git appends a tab after unquoted names containing spaces; remove it.
  const rest = line.slice(4).replace(/\t$/, '');
  return stripSidePrefix(decodeGitPath(rest), side);
}

function stripSidePrefix(path: string, side: 'a' | 'b'): string | undefined {
  return path.startsWith(`${side}/`) ? path.slice(2) : undefined;
}

const SIMPLE_ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/**
 * Undo git's path quoting. Unquoted paths are returned as they are.
 * `"caf\303\251.ts"` -> `café.ts`: octal escapes are raw UTF-8 bytes, so they are
 * collected as bytes first and decoded together.
 */
export function decodeGitPath(path: string): string {
  if (!(path.length >= 2 && path.startsWith('"') && path.endsWith('"'))) {
    return path;
  }
  // Array.from splits by character (not UTF-16 unit), so emoji stay in one piece.
  const chars = Array.from(path.slice(1, -1));
  const bytes: number[] = [];

  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '\\') {
      bytes.push(...Buffer.from(chars[i])); // ordinary character: keep its UTF-8 bytes
      continue;
    }

    // After a backslash: either 1-3 octal digits (one raw byte) or a one-letter escape.
    const octal = /^[0-7]{1,3}/.exec(chars.slice(i + 1, i + 4).join(''));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += octal[0].length;
    } else {
      const escaped = chars[i + 1] ?? '\\';
      bytes.push(SIMPLE_ESCAPES[escaped] ?? escaped.charCodeAt(0));
      i++;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function toRange(start: number, count: number): LineRange {
  if (count === 0) {
    // Pure deletion: no new lines exist. Git reports the line BEFORE the removed text,
    // so we mark that single line. This way a symbol that lost lines still shows as changed.
    const line = Math.max(start, 1); // a deletion at the very top is reported as line 0
    return { start: line, end: line };
  }
  return { start, end: start + count - 1 };
}
