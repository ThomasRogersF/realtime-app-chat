import type { Scenario, ScenarioIndex } from './types';

// NOTE: In Workers, JSON imports are supported by Wrangler bundler.
// This keeps the initial scaffold simple.
import index from '../../../scenarios/index.json';
import a1TaxiBogota from '../../../scenarios/a1_taxi_bogota.json';

const SCENARIOS: Record<string, Scenario> = {
  [a1TaxiBogota.id]: a1TaxiBogota as Scenario
};

export function getScenarioIndex(): ScenarioIndex {
  return index as ScenarioIndex;
}

export function getScenarioById(id: string): Scenario | null {
  return SCENARIOS[id] ?? null;
}
