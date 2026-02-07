import type { Scenario } from "../src/types/scenario.js";

import a1TaxiBogota from "./a1_taxi_bogota.json";
import a1OrderingCoffee from "./a1_ordering_coffee.json";

export const SCENARIOS: Scenario[] = [
  a1TaxiBogota as Scenario,
  a1OrderingCoffee as Scenario,
];

export const SCENARIO_MAP: Record<string, Scenario> = Object.fromEntries(
  SCENARIOS.map((s) => [s.id, s]),
);
