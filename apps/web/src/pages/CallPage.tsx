import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Scenario } from "@shared";
import { LocalScenarioRegistry } from "@shared";
import { useRealtimeTransport } from "../hooks/useRealtimeTransport";

const registry = new LocalScenarioRegistry();

const mockTranscript = [
  { role: "ai" as const, text: "¡Hola! ¿A dónde vamos?" },
  { role: "user" as const, text: "Al centro, por favor." },
];

export function CallPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { status, events, connect, send, disconnect } =
    useRealtimeTransport();

  useEffect(() => {
    if (!scenarioId) {
      setError("No scenario ID provided");
      setLoading(false);
      return;
    }

    registry
      .getScenarioById(scenarioId)
      .then(setScenario)
      .catch(() => setError(`Scenario not found: ${scenarioId}`))
      .finally(() => setLoading(false));
  }, [scenarioId]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-gray-400">Loading scenario…</p>
      </div>
    );
  }

  if (error || !scenario) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-gray-400">{error ?? "Scenario not found."}</p>
        <button
          onClick={() => navigate("/")}
          className="rounded bg-gray-800 px-4 py-2 text-sm transition hover:bg-gray-700"
        >
          ← Back to Menu
        </button>
      </div>
    );
  }

  function handleBigButton() {
    if (!scenarioId) return;
    if (status === "disconnected") {
      connect(scenarioId);
    } else {
      disconnect();
    }
  }

  const micLabel =
    status === "disconnected"
      ? "Tap to connect"
      : status === "connecting"
        ? "Connecting…"
        : "Connected — tap to disconnect";

  const micIcon =
    status === "disconnected" ? "🎤" : status === "connecting" ? "⏳" : "⏸";

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <button
          onClick={() => {
            disconnect();
            navigate("/");
          }}
          className="rounded bg-gray-800 px-3 py-1 text-sm transition hover:bg-gray-700"
        >
          ← Exit
        </button>
        <div className="text-center">
          <h1 className="text-sm font-medium text-gray-300">
            {scenario.title}
          </h1>
          {scenario.character && (
            <p className="text-xs text-gray-500">
              {scenario.character.name} — {scenario.character.role}
            </p>
          )}
        </div>
        {/* Progress placeholder */}
        <div className="h-2 w-24 rounded-full bg-gray-800">
          <div className="h-2 w-1/3 rounded-full bg-teal-500" />
        </div>
      </header>

      {/* Transcript */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-lg space-y-4">
          {mockTranscript.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                  msg.role === "ai"
                    ? "bg-teal-900/60 text-teal-100"
                    : "bg-indigo-900/60 text-indigo-100"
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Control Deck */}
      <footer className="border-t border-gray-800 px-4 py-6">
        <div className="flex flex-col items-center gap-3">
          {/* Status indicator */}
          <div
            className={`h-3 w-3 rounded-full transition-all ${
              status === "connected"
                ? "animate-pulse bg-teal-400 shadow-[0_0_12px_rgba(45,212,191,0.6)]"
                : status === "connecting"
                  ? "animate-pulse bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]"
                  : "bg-gray-600"
            }`}
          />

          {/* Big button */}
          <button
            onClick={handleBigButton}
            className={`flex h-24 w-24 items-center justify-center rounded-full border-4 transition-all ${
              status === "connected"
                ? "border-teal-400 bg-teal-500/20 shadow-[0_0_24px_rgba(45,212,191,0.4)]"
                : status === "connecting"
                  ? "border-amber-400 bg-amber-500/20 shadow-[0_0_24px_rgba(251,191,36,0.4)]"
                  : "border-gray-600 bg-gray-800 hover:border-gray-500"
            }`}
          >
            <span className="text-2xl">{micIcon}</span>
          </button>

          <span className="text-xs text-gray-500">{micLabel}</span>
        </div>
      </footer>

      {/* Dev debug panel */}
      {import.meta.env.DEV && (
        <div className="border-t border-gray-800 bg-gray-950 px-4 py-3">
          <div className="mx-auto max-w-lg">
            <div className="mb-2 flex items-center gap-3">
              <span className="text-xs font-medium text-gray-500">
                WS: {status}
              </span>
              <button
                onClick={() => send({ type: "client.ping" })}
                disabled={status !== "connected"}
                className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400 transition hover:bg-gray-700 disabled:opacity-40"
              >
                Ping
              </button>
              <button
                onClick={() =>
                  send({ type: "client.event", payload: { test: true } })
                }
                disabled={status !== "connected"}
                className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400 transition hover:bg-gray-700 disabled:opacity-40"
              >
                Echo test
              </button>
            </div>
            <pre className="max-h-48 overflow-y-auto rounded bg-gray-900 p-2 text-[10px] leading-tight text-gray-400">
              {events
                .slice(-10)
                .map((e, i) => JSON.stringify(e, null, 2))
                .join("\n---\n") || "(no events)"}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
