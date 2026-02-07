import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ScenarioSummary } from "@shared";
import { LocalScenarioRegistry } from "@shared";

const registry = new LocalScenarioRegistry();

function groupByLevel(
  scenarios: ScenarioSummary[],
): Record<string, ScenarioSummary[]> {
  const groups: Record<string, ScenarioSummary[]> = {};
  for (const s of scenarios) {
    (groups[s.level] ??= []).push(s);
  }
  return groups;
}

export function MenuPage() {
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    registry
      .listScenarios()
      .then(setScenarios)
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-gray-400">Loading scenarios…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-red-400">Failed to load scenarios: {error}</p>
      </div>
    );
  }

  const grouped = groupByLevel(scenarios);

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="mb-8 text-center text-3xl font-bold">
        Realtime AI Tutor
      </h1>

      {Object.entries(grouped).map(([level, items]) => (
        <section key={level} className="mb-8">
          <h2 className="mb-3 text-lg font-semibold text-teal-400">
            Level {level}
          </h2>

          <ul className="space-y-2">
            {items.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => navigate(`/call/${s.id}`)}
                  className="w-full rounded-lg bg-gray-800 px-4 py-3 text-left transition hover:bg-gray-700"
                >
                  <span className="font-medium">{s.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
