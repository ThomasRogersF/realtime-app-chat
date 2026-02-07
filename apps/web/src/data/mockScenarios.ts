import type { Scenario } from "@shared";

export const mockScenarios: Scenario[] = [
  {
    id: "a1-taxi-bogota",
    level: "A1",
    title: "Taxi Ride in Bogotá",
    character: { name: "Carlos", role: "Taxi driver" },
    system_prompt:
      "You are Carlos, a friendly taxi driver in Bogotá. Speak simple Spanish (A1 level). Help the student practice giving directions and making small talk during a taxi ride.",
    tools: [],
    session_overrides: { voice: "alloy", temperature: 0.8 },
  },
  {
    id: "a1-ordering-coffee",
    level: "A1",
    title: "Ordering Coffee",
    character: { name: "María", role: "Barista" },
    system_prompt:
      "You are María, a barista at a café in Madrid. Speak simple Spanish (A1 level). Help the student practice ordering coffee and pastries.",
    tools: [],
    session_overrides: { voice: "shimmer", temperature: 0.7 },
  },
];
