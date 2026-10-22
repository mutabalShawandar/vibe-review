import { edgeColor } from './layout';
import { splitPath } from './card';
import type { Feature } from './review';

/**
 * "Where to start": one section per feature (a group of changed files that import each other),
 * each with its own reading order. The first file of a section is where to start that feature.
 */
export function Sidebar({
  features,
  onPick,
  onHover,
  onLeave,
}: {
  features: Feature[];
  onPick(id: string): void;
  onHover(id: string): void;
  onLeave(): void;
}) {
  if (features.length === 0) {
    return (
      <aside className="sidebar">
        <h2 className="sidebar__title">Where to start</h2>
        <p className="sidebar__empty">No changed files to review.</p>
      </aside>
    );
  }
  return (
    <aside className="sidebar">
      <h2 className="sidebar__title">Where to start</h2>
      {features.map((feature) => {
        const color = edgeColor(feature.id);
        return (
          <section key={feature.id} className="feature" style={{ ['--feature' as string]: color }}>
            <h3 className="feature__title" title={feature.title}>
              {feature.title}
              <span className="feature__count">
                {feature.items.length} {feature.items.length === 1 ? 'file' : 'files'}
              </span>
            </h3>
            <ol className="feature__list">
              {feature.items.map((item) => {
                const { name, folder } = splitPath(item.id);
                return (
                  <li key={item.id}>
                    <button
                      className="review-item"
                      onClick={() => onPick(item.id)}
                      onMouseEnter={() => onHover(item.id)}
                      onMouseLeave={onLeave}
                    >
                      <span className="order-badge" style={{ background: color }}>
                        {item.order}
                      </span>
                      <span className="review-item__text">
                        <span className="review-item__name">
                          {name}
                          {item.order === 1 && <span className="chip chip-start">start here</span>}
                        </span>
                        {folder && <span className="review-item__folder">{folder}</span>}
                        <span className="review-item__reason">{item.reason}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </aside>
  );
}
