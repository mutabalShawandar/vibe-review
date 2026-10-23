import type { FileRole } from '../../src/core/FrameworkStrategy';

/**
 * The layout puts files in horizontal bands, top to bottom, so the diagram reads like the
 * architecture: what the user sees on top, the server below it, shared things at the bottom.
 * There are no borders or labels: the bands are only the space between groups of cards.
 */
export type Zone = 'frontend' | 'backend' | 'shared';

/** Top to bottom. */
export const ZONE_ORDER: readonly Zone[] = ['frontend', 'backend', 'shared'];

const ZONE_OF_ROLE: Record<FileRole, Zone> = {
  page: 'frontend',
  ui: 'frontend',
  hook: 'frontend',
  api: 'backend',
  lib: 'backend',
  types: 'shared',
  test: 'shared',
  other: 'shared',
};

/** Within a zone, cards of one role stay together, in this order (a screen first, then what it is built from). */
const ROLE_ORDER: readonly FileRole[] = ['page', 'ui', 'hook', 'api', 'lib', 'types', 'test', 'other'];

/** The band a file goes in. A file nothing recognized (no role) goes to the shared band. */
export function zoneOf(role: FileRole | undefined): Zone {
  return ZONE_OF_ROLE[role ?? 'other'];
}

/** Sort key that keeps cards of one role together inside a zone. */
export function roleRank(role: FileRole | undefined): number {
  return ROLE_ORDER.indexOf(role ?? 'other');
}
