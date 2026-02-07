import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Scenario } from "@shared";
import { LocalScenarioRegistry } from "@shared";
import {
  useRealtimeTransport,
  type ServerEvent,
} from "../hooks/useRealtimeTransport";

const WORKER_WS_URL = import.meta.env.VITE_WORKER_WS_URL ?? "ws://localhost:8787/ws";

interface TranscriptMessage {
  role: "ai" | "user";
  text: string;
  streaming?: boolean;
}

const registry = new LocalScenarioRegistry();

export function CallPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [textInput, setTextInput] = useState("");
  const [debugEvents, setDebugEvents] = useState<ServerEvent[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Load scenario
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

  // Handle server events
  const onEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case "server.text.delta": {
        const delta = event.delta as string;
        setTranscript((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "ai" && last.streaming) {
            // Append delta to current streaming message
            return [
              ...prev.slice(0, -1),
              { ...last, text: last.text + delta },
            ];
          }
          // Start new streaming AI message
          return [...prev, { role: "ai", text: delta, streaming: true }];
        });
        break;
      }

      case "server.text.completed": {
        const text = event.text as string;
        setTranscript((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "ai" && last.streaming) {
            // Finalize streaming message with the complete text
            return [
              ...prev.slice(0, -1),
              { role: "ai", text, streaming: false },
            ];
          }
          // Fallback — add as new completed message
          return [...prev, { role: "ai", text, streaming: false }];
        });
        break;
      }

      case "server.error": {
        const errMsg = event.error as string;
        setTranscript((prev) => [
          ...prev,
          { role: "ai", text: `[Error: ${errMsg}]`, streaming: false },
        ]);
        break;
      }

      case "debug.openai": {
        setDebugEvents((prev) => [...prev.slice(-99), event]);
        break;
      }

      default:
        // server.hello, server.pong, server.echo, etc.
        setDebugEvents((prev) => [...prev.slice(-99), event]);
        break;
    }
  }, []);

  const transport = useRealtimeTransport({
    url: WORKER_WS_URL,
    scenarioId: scenarioId ?? "",
    onEvent,
  });

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-gray-400">Loading scenario...</p>
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
          &larr; Back to Menu
        </button>
      </div>
    );
  }

  function handleSendText() {
    const text = textInput.trim();
    if (!text) return;

    // Append user message to transcript
    setTranscript((prev) => [...prev, { role: "user", text, streaming: false }]);
    setTextInput("");

    // Send to worker
    transport.send({ type: "client.text", text });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <button
          onClick={() => {
            transport.disconnect();
            navigate("/");
          }}
          className="rounded bg-gray-800 px-3 py-1 text-sm transition hover:bg-gray-700"
        >
          &larr; Exit
        </button>
        <div className="text-center">
          <h1 className="text-sm font-medium text-gray-300">
            {scenario.title}
          </h1>
          {scenario.character && (
            <p className="text-xs text-gray-500">
              {scenario.character.name} &mdash; {scenario.character.role}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Connection status indicator */}
          <div
            className={`h-2 w-2 rounded-full ${
              transport.status === "connected"
                ? "bg-green-400"
                : transport.status === "connecting"
                  ? "animate-pulse bg-amber-400"
                  : transport.status === "error"
                    ? "bg-red-400"
                    : "bg-gray-600"
            }`}
            title={transport.status}
          />
          <button
            onClick={() => setShowDebug((v) => !v)}
            className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-400 transition hover:bg-gray-700"
          >
            {showDebug ? "Hide Debug" : "Debug"}
          </button>
        </div>
      </header>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Transcript */}
        <main className="flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-lg space-y-4">
            {transcript.length === 0 && transport.status === "disconnected" && (
              <div className="text-center text-gray-500">
                <p className="mb-4">Press Connect to start the conversation.</p>
                <button
                  onClick={transport.connect}
                  className="rounded-lg bg-teal-600 px-6 py-3 font-medium text-white transition hover:bg-teal-500"
                >
                  Connect
                </button>
              </div>
            )}

            {transcript.length === 0 && transport.status === "connecting" && (
              <p className="text-center text-gray-500 animate-pulse">
                Connecting...
              </p>
            )}

            {transcript.length === 0 && transport.status === "connected" && (
              <p className="text-center text-gray-500">
                Connected. Type a message below to start.
              </p>
            )}

            {transcript.map((msg, i) => (
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
                  {msg.streaming && (
                    <span className="ml-1 inline-block animate-pulse text-teal-300">
                      |
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </main>

        {/* Debug panel */}
        {showDebug && (
          <aside className="w-80 overflow-y-auto border-l border-gray-800 bg-gray-900 p-3">
            <h3 className="mb-2 text-xs font-bold uppercase text-gray-500">
              Debug Events
            </h3>
            <div className="space-y-1">
              {debugEvents.length === 0 && (
                <p className="text-xs text-gray-600">No events yet.</p>
              )}
              {debugEvents.map((evt, i) => (
                <pre
                  key={i}
                  className="overflow-x-auto rounded bg-gray-800 p-1.5 text-[10px] leading-tight text-gray-400"
                >
                  {JSON.stringify(evt, null, 1)}
                </pre>
              ))}
            </div>
          </aside>
        )}
      </div>

      {/* Text input footer */}
      <footer className="border-t border-gray-800 px-4 py-3">
        <div className="mx-auto flex max-w-lg items-center gap-2">
          {transport.status === "disconnected" ? (
            <button
              onClick={transport.connect}
              className="w-full rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-500"
            >
              Connect
            </button>
          ) : (
            <>
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  transport.status === "connected"
                    ? "Type a message..."
                    : "Connecting..."
                }
                disabled={transport.status !== "connected"}
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-teal-500 focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={handleSendText}
                disabled={transport.status !== "connected" || !textInput.trim()}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-500 disabled:opacity-50"
              >
                Send
              </button>
              <button
                onClick={transport.disconnect}
                className="rounded-lg bg-gray-700 px-3 py-2 text-sm text-gray-300 transition hover:bg-gray-600"
                title="Disconnect"
              >
                &times;
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
