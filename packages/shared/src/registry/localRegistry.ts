import type { ScenarioRegistry, ScenarioSummary, Scenario } from "../types/scenario.js";
import { SCENARIOS, SCENARIO_MAP } from "../../scenarios/index.js";

export class LocalScenarioRegistry implements ScenarioRegistry {
  async listScenarios(): Promise<ScenarioSummary[]> {
    return SCENARIOS.map(({ id, level, title }) => ({ id, level, title }));
  }

  async getScenarioById(id: string): Promise<Scenario> {
    const scenario = SCENARIO_MAP[id];
    if (!scenario) {
      throw new Error(`Scenario not found: ${id}`);
    }
    return scenario;
  }
}
