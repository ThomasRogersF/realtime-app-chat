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

const levelColors: Record<string, { pill: string; border: string }> = {
  A1: { pill: "bg-emerald-100 text-emerald-700", border: "border-emerald-200" },
  A2: { pill: "bg-teal-100 text-teal-700", border: "border-teal-200" },
  B1: { pill: "bg-sky-100 text-sky-700", border: "border-sky-200" },
  B2: { pill: "bg-violet-100 text-violet-700", border: "border-violet-200" },
  C1: { pill: "bg-amber-100 text-amber-700", border: "border-amber-200" },
  C2: { pill: "bg-rose-100 text-rose-700", border: "border-rose-200" },
};

function levelStyle(level: string) {
  return levelColors[level] ?? { pill: "bg-slate-100 text-slate-600", border: "border-slate-200" };
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
      <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--muted)]">Loading scenarios…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--danger)]">Failed to load scenarios: {error}</p>
      </div>
    );
  }

  const grouped = groupByLevel(scenarios);

  return (
    <div className="min-h-screen bg-[var(--bg)] px-4 py-10">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-2 text-center text-3xl font-extrabold text-[var(--text)]">
          Realtime AI Tutor
        </h1>
        <p className="mb-10 text-center text-sm text-[var(--muted)]">
          Pick a scenario and start practicing
        </p>

        {Object.entries(grouped).map(([level, items]) => {
          const style = levelStyle(level);
          return (
            <section key={level} className="mb-8">
              <div className="mb-3 flex items-center gap-2">
                <span
                  className={`inline-block rounded-full px-3 py-0.5 text-xs font-bold ${style.pill}`}
                >
                  {level}
                </span>
                <span className="text-sm font-semibold text-[var(--muted)]">
                  Level {level}
                </span>
              </div>

              <ul className="space-y-3">
                {items.map((s) => (
                  <li key={s.id}>
                    <div
                      className={`flex items-center justify-between rounded-2xl border bg-[var(--surface)] px-5 py-4 shadow-sm transition hover:shadow-md ${style.border}`}
                    >
                      <span className="font-semibold text-[var(--text)]">
                        {s.title}
                      </span>
                      <button
                        onClick={() => navigate(`/call/${s.id}`)}
                        className="rounded-2xl bg-[var(--primary)] px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[var(--primary-hover)] active:scale-95"
                      >
                        Start
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
