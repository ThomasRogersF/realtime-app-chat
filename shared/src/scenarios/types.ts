export type ScenarioTool = {
  type: 'function';
  name: string;
  description?: string;
  parameters: Record<string, unknown>; // JSON Schema
};

export type Scenario = {
  id: string;
  level: string;
  title: string;
  system: string;
  opening_line: string;
  tools: ScenarioTool[];
};

export type ScenarioIndexEntry = {
  id: string;
  level: string;
  title: string;
};

export type ScenarioIndex = {
  scenarios: ScenarioIndexEntry[];
};
