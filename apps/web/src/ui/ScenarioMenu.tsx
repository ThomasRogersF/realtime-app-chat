import React, { useEffect, useMemo, useState } from 'react';

type ScenarioIndex = {
  scenarios: Array<{ id: string; level: string; title: string }>;
};

export function ScenarioMenu(props: {
  userId: string;
  onStart: (scenario: { id: string; level: string; title: string }) => void;
}) {
  const [index, setIndex] = useState<ScenarioIndex | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/scenarios');
        if (!res.ok) throw new Error(`Failed to load scenarios: ${res.status}`);
        const data = (await res.json()) as ScenarioIndex;
        if (cancelled) return;
        setIndex(data);
        const first = data.scenarios[0];
        if (first) {
          setSelectedLevel(first.level);
          setSelectedScenarioId(first.id);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const levels = useMemo(() => {
    const set = new Set((index?.scenarios ?? []).map((s) => s.level));
    return Array.from(set);
  }, [index]);

  const scenariosForLevel = useMemo(() => {
    return (index?.scenarios ?? []).filter((s) => (selectedLevel ? s.level === selectedLevel : true));
  }, [index, selectedLevel]);

  const selectedScenario = useMemo(() => {
    return (index?.scenarios ?? []).find((s) => s.id === selectedScenarioId) ?? null;
  }, [index, selectedScenarioId]);

  return (
    <div className="container">
      <div className="header">
        <div>
          <div style={{ fontWeight: 700 }}>Native Multimodal Real-Time AI Tutor</div>
          <div className="small">User: {props.userId}</div>
        </div>
        <div className="small">Scenario select</div>
      </div>

      <div className="transcript">
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Choose a scenario</div>
          {error && <div style={{ color: '#fca5a5' }}>{error}</div>}

          {!index ? (
            <div className="small">Loading…</div>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 12 }}>
                <div>
                  <div className="small" style={{ marginBottom: 6 }}>
                    Level
                  </div>
                  <select
                    className="select"
                    value={selectedLevel}
                    onChange={(e) => {
                      const lvl = e.target.value;
                      setSelectedLevel(lvl);
                      const first = index.scenarios.find((s) => s.level === lvl);
                      if (first) setSelectedScenarioId(first.id);
                    }}
                  >
                    {levels.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="small" style={{ marginBottom: 6 }}>
                    Scenario
                  </div>
                  <select
                    className="select"
                    value={selectedScenarioId}
                    onChange={(e) => setSelectedScenarioId(e.target.value)}
                  >
                    {scenariosForLevel.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                className="bigButton"
                disabled={!selectedScenario}
                onClick={() => {
                  if (selectedScenario) props.onStart(selectedScenario);
                }}
              >
                Start
              </button>

              <div className="small" style={{ marginTop: 10 }}>
                This scaffold connects to OpenAI Realtime over WebSockets via a Cloudflare Worker + Durable Object.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
