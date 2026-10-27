import { FrameworkRegistry } from '../core/FrameworkRegistry';
import { NextJsStrategy } from './nextjs/NextJsStrategy';

/**
 * The ONLY place framework strategies are registered.
 * To support a new framework: implement FrameworkStrategy in src/frameworks/<name>/
 * and add one `registry.register(...)` line below.
 */
export function createFrameworkRegistry(): FrameworkRegistry {
  const registry = new FrameworkRegistry();
  registry.register(new NextJsStrategy());
  return registry;
}
