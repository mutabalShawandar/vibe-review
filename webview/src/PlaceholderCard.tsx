import type { Node, NodeProps } from '@xyflow/react';
import { CARD_WIDTH, splitPath } from './card';

export const PLACEHOLDER_HEIGHT = 96;

export type PlaceholderNode = Node<{ file: string }, 'placeholder'>;

/**
 * Stands in for a file that is being written but is not in the diagram yet (a new file, or the
 * first edit of a clean one). The view follows the agent here; when the next refresh brings the
 * real card, this one disappears.
 */
export function PlaceholderCard({ data }: NodeProps<PlaceholderNode>) {
  const { name, folder } = splitPath(data.file);
  return (
    <div className="placeholder-card" style={{ width: CARD_WIDTH, height: PLACEHOLDER_HEIGHT }}>
      <div className="placeholder-card__title">
        <span className="typing">
          <i />
          <i />
          <i />
        </span>
        Agent is working on a file
      </div>
      <div className="placeholder-card__name" title={data.file}>
        {name}
      </div>
      <div className="placeholder-card__hint">{folder ? `${folder} · ` : ''}it appears here as soon as the edit settles</div>
    </div>
  );
}
