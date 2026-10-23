import { FrameworkRegistry } from '../core/FrameworkRegistry';
import { GenericStrategy } from './generic/GenericStrategy';
import { NextJsStrategy } from './nextjs/NextJsStrategy';

/**
 * The ONLY place framework strategies are registered.
 * To support a new framework: implement FrameworkStrategy in src/frameworks/<name>/ and add one
 * `registry.register(...)` line below, above the generic fallback. Order matters: the first
 * strategy that detects its framework in the workspace wins, so list the more specific ones first.
 */
export function createFrameworkRegistry(): FrameworkRegistry {
  const registry = new FrameworkRegistry();
  registry.register(new NextJsStrategy());
  registry.register(new GenericStrategy()); // last: matches every workspace
  return registry;
}
