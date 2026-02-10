export interface ToolSchema {
  name: string;
  description?: string;
  parameters: Record<string, any>;
}

export interface VocabEntry {
  term: string;
  translation?: string;
}

export interface GradingCriterion {
  name: string;
  weight: number;
  description: string;
}

export interface GradingRubric {
  criteria: GradingCriterion[];
}

export interface AutoQuizConfig {
  enabled: boolean;
  when: "end_call" | "tool_trigger";
  num_questions?: number;
}

export interface KickoffConfig {
  enabled: boolean;
  max_turns?: number;
  style?: string;
  prompt: string;
}

export interface Scenario {
  id: string;
  level: string;
  title: string;
  character?: { name: string; role: string };
  system_prompt: string;
  tools?: ToolSchema[];
  session_overrides?: { voice?: string; temperature?: number };
  learning_objectives?: string[];
  target_phrases?: string[];
  vocab?: VocabEntry[];
  grading_rubric?: GradingRubric;
  auto_quiz?: AutoQuizConfig;
  kickoff?: KickoffConfig;
}

export type ScenarioSummary = Pick<Scenario, "id" | "level" | "title">;

export interface ScenarioRegistry {
  listScenarios(): Promise<ScenarioSummary[]>;
  getScenarioById(id: string): Promise<Scenario>;
}
