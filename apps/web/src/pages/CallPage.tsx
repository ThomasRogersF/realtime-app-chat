import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { mockScenarios } from "../data/mockScenarios";

type MicState = "idle" | "active" | "processing";

const mockTranscript = [
  { role: "ai" as const, text: "¡Hola! ¿A dónde vamos?" },
  { role: "user" as const, text: "Al centro, por favor." },
];

export function CallPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const [micState, setMicState] = useState<MicState>("idle");

  const scenario = mockScenarios.find((s) => s.id === scenarioId);

  if (!scenario) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-gray-400">Scenario not found.</p>
      </div>
    );
  }

  function cycleMic() {
    setMicState((prev) => {
      if (prev === "idle") return "active";
      if (prev === "active") return "processing";
      return "idle";
    });
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <button
          onClick={() => navigate("/")}
          className="rounded bg-gray-800 px-3 py-1 text-sm transition hover:bg-gray-700"
        >
          ← Exit
        </button>
        <h1 className="text-sm font-medium text-gray-300">
          {scenario.title}
        </h1>
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
          {/* Speaking indicator placeholder */}
          <div
            className={`h-3 w-3 rounded-full transition-all ${
              micState === "active"
                ? "animate-pulse bg-teal-400 shadow-[0_0_12px_rgba(45,212,191,0.6)]"
                : micState === "processing"
                  ? "animate-pulse bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]"
                  : "bg-gray-600"
            }`}
          />

          {/* Mic button */}
          <button
            onClick={cycleMic}
            className={`flex h-24 w-24 items-center justify-center rounded-full border-4 transition-all ${
              micState === "active"
                ? "border-teal-400 bg-teal-500/20 shadow-[0_0_24px_rgba(45,212,191,0.4)]"
                : micState === "processing"
                  ? "border-amber-400 bg-amber-500/20 shadow-[0_0_24px_rgba(251,191,36,0.4)]"
                  : "border-gray-600 bg-gray-800 hover:border-gray-500"
            }`}
          >
            <span className="text-2xl">
              {micState === "idle" && "🎤"}
              {micState === "active" && "⏸"}
              {micState === "processing" && "⏳"}
            </span>
          </button>

          <span className="text-xs text-gray-500">
            {micState === "idle" && "Tap to speak"}
            {micState === "active" && "Listening…"}
            {micState === "processing" && "Processing…"}
          </span>
        </div>
      </footer>
    </div>
  );
}
