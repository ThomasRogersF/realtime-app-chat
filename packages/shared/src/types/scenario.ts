export interface ToolSchema {
  name: string;
  description?: string;
  parameters: Record<string, any>;
}

export interface Scenario {
  id: string;
  level: string;
  title: string;
  character?: { name: string; role: string };
  system_prompt: string;
  tools?: ToolSchema[];
  session_overrides?: { voice?: string; temperature?: number };
}

export type ScenarioSummary = Pick<Scenario, "id" | "level" | "title">;

export interface ScenarioRegistry {
  listScenarios(): Promise<ScenarioSummary[]>;
  getScenarioById(id: string): Promise<Scenario>;
}
