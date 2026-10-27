import { FileCard } from '../FileCard';
import { GroupBox, GroupCard } from '../GroupCard';
import { PlaceholderCard } from '../PlaceholderCard';

/**
 * The component that draws each kind of node, for every view. A renderer's nodes use the `type`
 * names below. Defined once, outside any component, or React Flow would re-create every node on each render.
 */
export const nodeTypes = {
  fileCard: FileCard,
  placeholder: PlaceholderCard,
  groupCard: GroupCard,
  groupBox: GroupBox,
};
