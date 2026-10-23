import type { FileRole } from '../../src/core/FrameworkStrategy';

/**
 * How each role looks: a short label for the chip and one color, shared by the chip and the
 * tint of the card header. The hues are far apart from each other and from the status colors
 * (changed is amber, uses is blue, used-by is orange); they are readable on light and dark themes.
 * `other` has no entry on purpose: a file nothing recognized shows no chip.
 */
export const ROLE_STYLE: Record<Exclude<FileRole, 'other'>, { label: string; color: string; hint: string }> = {
  page: { label: 'Page', color: '#d6409f', hint: 'A screen or route: what the user navigates to' },
  ui: { label: 'UI', color: '#2fa8a0', hint: 'A reusable piece of interface (a component)' },
  api: { label: 'API', color: '#8a63d2', hint: 'A server endpoint, route handler or middleware' },
  hook: { label: 'Hook', color: '#5b8def', hint: 'Reusable stateful logic for the interface' },
  lib: { label: 'Logic', color: '#9aa34a', hint: 'Logic and data without UI: utilities, services, stores' },
  types: { label: 'Types', color: '#8a8f98', hint: 'Type declarations' },
  test: { label: 'Test', color: '#c9783a', hint: 'A test' },
};
