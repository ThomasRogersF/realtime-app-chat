import { useNavigate } from "react-router-dom";
import { mockScenarios } from "../data/mockScenarios";
import type { Scenario } from "@shared";

function groupByLevel(scenarios: Scenario[]): Record<string, Scenario[]> {
  const groups: Record<string, Scenario[]> = {};
  for (const s of scenarios) {
    (groups[s.level] ??= []).push(s);
  }
  return groups;
}

export function MenuPage() {
  const navigate = useNavigate();
  const grouped = groupByLevel(mockScenarios);

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="mb-8 text-center text-3xl font-bold">
        Realtime AI Tutor
      </h1>

      {Object.entries(grouped).map(([level, scenarios]) => (
        <section key={level} className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-teal-400">
            Level {level}
          </h2>

          <ul className="space-y-2">
            {scenarios.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => navigate(`/call/${s.id}`)}
                  className="w-full rounded-lg bg-gray-800 px-4 py-3 text-left transition hover:bg-gray-700"
                >
                  <span className="font-medium">{s.title}</span>
                  {s.character && (
                    <span className="ml-2 text-sm text-gray-400">
                      — {s.character.name}, {s.character.role}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
