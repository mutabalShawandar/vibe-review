import { StrategyRegistry } from '../core/StrategyRegistry';
import { TypeScriptStrategy } from './typescript/TypeScriptStrategy';

/**
 * The ONLY place language strategies are registered.
 * To support a new language: implement LanguageStrategy in src/languages/<lang>/
 * and add one `registry.register(...)` line below.
 */
export function createRegistry(): StrategyRegistry {
  const registry = new StrategyRegistry();
  registry.register(new TypeScriptStrategy());
  return registry;
}
