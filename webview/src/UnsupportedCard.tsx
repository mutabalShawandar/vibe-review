import { useState } from 'react';
import type { UnsupportedLanguage } from '../../src/core/types';
import { PROJECT_URL } from '../../src/ui/messages';
import { splitPath } from './card';
import { vscode } from './vscode';

const SHOWN_FILES = 6;
const ADD_SUPPORT_URL = `${PROJECT_URL}blob/main/CONTRIBUTING.md#adding-a-language`;

/**
 * A note in the corner of the canvas for languages the project uses but Vibe Review cannot read
 * yet: those files are not in the diagram, and this says so instead of leaving the reviewer to wonder.
 * Languages with changes come first (the host sorts them), and their changed files are named.
 */
export function UnsupportedCard({ languages }: { languages: UnsupportedLanguage[] }) {
  const [open, setOpen] = useState(true);
  const changedCount = languages.reduce((sum, language) => sum + language.changed.length, 0);

  if (!open) {
    return (
      <button className="unsupported unsupported--closed" onClick={() => setOpen(true)} title="Languages that are not in the diagram yet">
        Not analyzed yet: {languages.map((language) => language.language).join(', ')}
      </button>
    );
  }

  return (
    <aside className="unsupported" aria-label="Languages not analyzed yet">
      <header className="unsupported__header">
        <strong>Not analyzed yet</strong>
        <button className="unsupported__close" onClick={() => setOpen(false)} title="Collapse" aria-label="Collapse">
          ×
        </button>
      </header>
      <p className="unsupported__text">
        {changedCount > 0
          ? 'Changes in these languages are not in the diagram, so review them in the editor.'
          : 'These files are not in the diagram: Vibe Review cannot read them yet.'}
      </p>
      <ul className="unsupported__list">
        {languages.map((language) => (
          <li key={language.language}>
            <div className="unsupported__language">
              <span>{language.language}</span>
              <span className="unsupported__count">
                {language.files} {language.files === 1 ? 'file' : 'files'}
                {language.changed.length > 0 && <strong> · {language.changed.length} changed</strong>}
              </span>
            </div>
            {language.changed.slice(0, SHOWN_FILES).map((file) => (
              <div
                key={file}
                className="unsupported__file"
                title={file}
                onClick={() => vscode.postMessage({ type: 'openFile', file })}
              >
                {splitPath(file).name}
                <span className="unsupported__folder">{splitPath(file).folder}</span>
              </div>
            ))}
            {language.changed.length > SHOWN_FILES && (
              <div className="unsupported__more">+{language.changed.length - SHOWN_FILES} more changed</div>
            )}
          </li>
        ))}
      </ul>
      <button className="unsupported__link" onClick={() => vscode.postMessage({ type: 'openLink', url: ADD_SUPPORT_URL })}>
        Add or request support
      </button>
    </aside>
  );
}
