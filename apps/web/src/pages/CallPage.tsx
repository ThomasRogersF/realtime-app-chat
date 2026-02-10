import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Scenario } from "@shared";
import { LocalScenarioRegistry } from "@shared";
import {
  useRealtimeTransport,
  type RealtimeEvent,
} from "../hooks/useRealtimeTransport";
import { useMicPcmStream } from "../audio/useMicPcmStream";
import { Pcm16Player } from "../audio/pcm16Player";

const registry = new LocalScenarioRegistry();

interface TranscriptMessage {
  role: "ai" | "user";
  text: string;
  /** true while AI is still streaming deltas */
  streaming?: boolean;
}

export function CallPage() {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [textInput, setTextInput] = useState("");
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  /** Phase 7: Recent tool results for debug display */
  const [toolResults, setToolResults] = useState<
    Array<{ name: string; result: unknown; ts: number }>
  >([]);
  const [debugOpen, setDebugOpen] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Pcm16Player | null>(null);
  const aiSpeakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Phase 6: Timestamp until which late audio deltas are dropped after barge-in */
  const ignoreAudioUntilRef = useRef(0);
  /** PTT guard: true if at least one audio chunk was sent during the current PTT hold */
  const pttAudioSentRef = useRef(false);

  const {
    status,
    events,
    sessionKey,
    onServerEventRef,
    connect,
    send,
    sendAudioAppend,
    sendAudioCommit,
    sendResponseCreate,
    sendResponseCancel,
    endCall,
    disconnect,
  } = useRealtimeTransport();

  // ── Mic streaming (Phase 4) ────────────────────────────────
  const sendAudioAppendTracked = useCallback(
    (buffer: ArrayBuffer) => {
      pttAudioSentRef.current = true;
      sendAudioAppend(buffer);
    },
    [sendAudioAppend],
  );
  const mic = useMicPcmStream(sendAudioAppendTracked);

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

  // Auto-scroll transcript to bottom
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  // Handle incoming events from the transport
  const handleServerEvent = useCallback((evt: RealtimeEvent) => {
    switch (evt.type) {
      case "server.text.delta": {
        const delta = typeof evt.delta === "string" ? evt.delta : "";
        setTranscript((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "ai" && last.streaming) {
            // Append delta to the current streaming message
            return [
              ...prev.slice(0, -1),
              { ...last, text: last.text + delta },
            ];
          }
          // Start a new streaming AI message
          return [...prev, { role: "ai", text: delta, streaming: true }];
        });
        break;
      }

      case "server.text.completed": {
        const fullText = typeof evt.text === "string" ? evt.text : "";
        setTranscript((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "ai" && last.streaming) {
            // Finalize the streaming message
            return [
              ...prev.slice(0, -1),
              { role: "ai", text: fullText, streaming: false },
            ];
          }
          // No streaming message found; just append completed
          return [...prev, { role: "ai", text: fullText }];
        });
        break;
      }

      // Phase 4: Surface completed transcription as a user bubble
      case "server.transcription.completed": {
        const text = typeof evt.text === "string" ? evt.text : "";
        if (text) {
          setTranscript((prev) => [...prev, { role: "user", text }]);
        }
        break;
      }

      // Phase 5: AI audio playback
      case "server.audio.delta": {
        // Phase 6: Drop late audio deltas that arrive after barge-in
        if (Date.now() < ignoreAudioUntilRef.current) {
          break;
        }
        const delta = typeof evt.delta === "string" ? evt.delta : "";
        if (delta && playerRef.current) {
          console.log("[audio.delta]", delta.length);
          playerRef.current.playBase64Pcm16Delta(delta);
          setIsAiSpeaking(true);
          // Clear any pending "done" timer since we got a new delta
          if (aiSpeakingTimerRef.current) {
            clearTimeout(aiSpeakingTimerRef.current);
            aiSpeakingTimerRef.current = null;
          }
        }
        break;
      }

      case "server.audio.done": {
        // Brief delay before clearing the glow so the last chunk finishes playing
        aiSpeakingTimerRef.current = setTimeout(() => {
          setIsAiSpeaking(false);
          aiSpeakingTimerRef.current = null;
        }, 500);
        break;
      }

      // ── Phase 6: Barge-in — user started speaking ──────────
      case "server.user_speech_started": {
        // 1. Hard-stop AI audio playback immediately
        if (playerRef.current) {
          playerRef.current.stopHard();
          playerRef.current.resetQueue();
        }
        // 2. Turn off AI speaking indicator
        setIsAiSpeaking(false);
        if (aiSpeakingTimerRef.current) {
          clearTimeout(aiSpeakingTimerRef.current);
          aiSpeakingTimerRef.current = null;
        }
        // 3. Cancel in-flight response on server
        sendResponseCancel();
        // 4. Ignore any straggler audio deltas for 200ms
        ignoreAudioUntilRef.current = Date.now() + 200;
        break;
      }

      case "server.user_speech_stopped": {
        // No action needed — transcription.completed will add the user bubble
        break;
      }

      // ── Phase 10: Fallback to clear AI speaking after response ends ──
      case "server.response.done": {
        setIsAiSpeaking(false);
        if (aiSpeakingTimerRef.current) {
          clearTimeout(aiSpeakingTimerRef.current);
          aiSpeakingTimerRef.current = null;
        }
        ignoreAudioUntilRef.current = 0;
        break;
      }

      // ── Phase 7: Tool results (debug only) ───────────────────
      case "server.tool_result": {
        const name = typeof evt.name === "string" ? evt.name : "unknown";
        setToolResults((prev) =>
          [...prev, { name, result: evt.result, ts: Date.now() }].slice(-5),
        );
        break;
      }

      // ── Phase 8: Call ended — navigate to results ──────────
      case "server.call_ended": {
        mic.stop();
        disconnect();
        if (sessionKey) {
          navigate(`/results/${sessionKey}`);
        } else {
          navigate("/");
        }
        break;
      }
    }
  }, [sendResponseCancel, sessionKey, navigate, mic, disconnect]);

  // Phase 10.2: Deliver server events directly via ref callback
  // (bypasses the capped events sliding-window array)
  onServerEventRef.current = handleServerEvent;

  // Reset transcript on new connection
  useEffect(() => {
    if (status === "connecting") {
      setTranscript([]);
      setToolResults([]);
    }
  }, [status]);

  // Stop mic if we disconnect
  useEffect(() => {
    if (status === "disconnected" && mic.isCapturing) {
      mic.stop();
    }
  }, [status, mic.isCapturing, mic.stop]);

  // Phase 5: Create/dispose PCM16 player based on connection status
  useEffect(() => {
    if (status === "connected") {
      playerRef.current = new Pcm16Player();
    }
    return () => {
      if (playerRef.current) {
        playerRef.current.close();
        playerRef.current = null;
      }
      setIsAiSpeaking(false);
      if (aiSpeakingTimerRef.current) {
        clearTimeout(aiSpeakingTimerRef.current);
        aiSpeakingTimerRef.current = null;
      }
    };
  }, [status]);

  function handleSendText() {
    const text = textInput.trim();
    if (!text || status !== "connected") return;

    // Append user bubble locally
    setTranscript((prev) => [...prev, { role: "user", text }]);
    send({ type: "client.text", text });
    setTextInput("");
  }

  function handleTextKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  }

  // ── Push-to-talk handlers ──────────────────────────────────
  function handlePttDown() {
    if (status !== "connected") return;
    pttAudioSentRef.current = false;
    mic.start();
  }

  function handlePttUp() {
    if (!mic.isCapturing) return;
    mic.stop();
    // Only commit + request response if audio was actually captured
    if (pttAudioSentRef.current) {
      sendAudioCommit();
      sendResponseCreate();
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg)]">
        <p className="text-[var(--muted)]">Loading scenario...</p>
      </div>
    );
  }

  if (error || !scenario) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-[var(--bg)]">
        <p className="text-[var(--muted)]">{error ?? "Scenario not found."}</p>
        <button
          onClick={() => navigate("/")}
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm text-[var(--text)] shadow-sm transition hover:shadow-md"
        >
          &larr; Back to Menu
        </button>
      </div>
    );
  }

  // When disconnected, big button connects. When connected, it's push-to-talk.
  function handleBigButtonClick() {
    if (!scenarioId) return;
    if (status === "disconnected") {
      connect(scenarioId);
    } else if (status === "connected") {
      // Click (not hold) while connected → disconnect
      // Push-to-talk is handled by pointer events below
    }
  }

  const isRecording = mic.isCapturing;

  const micLabel =
    status === "disconnected"
      ? "Tap to connect"
      : status === "connecting"
        ? "Connecting..."
        : isRecording
          ? "Recording…"
          : isAiSpeaking
            ? "AI speaking…"
            : "Hold to talk";

  const micIcon =
    status === "disconnected"
      ? "\uD83C\uDFA4"
      : status === "connecting"
        ? "\u23F3"
        : isRecording
          ? "\uD83D\uDD34"
          : "\uD83C\uDFA4";

  return (
    <div className="flex h-screen flex-col bg-[var(--bg)]">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-sm">
        <button
          onClick={() => {
            mic.stop();
            disconnect();
            navigate("/");
          }}
          className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-sm text-[var(--text)] transition hover:shadow-sm"
        >
          &larr; Exit
        </button>
        <div className="text-center">
          <h1 className="text-sm font-semibold text-[var(--text)]">
            {scenario.title}
          </h1>
          {scenario.character && (
            <p className="text-xs text-[var(--muted)]">
              {scenario.character.name} — {scenario.character.role}
            </p>
          )}
        </div>
        {/* Progress bar */}
        <div className="h-2.5 w-24 overflow-hidden rounded-full bg-amber-100">
          <div className="h-2.5 w-1/3 rounded-full bg-gradient-to-r from-yellow-400 to-green-400" />
        </div>
      </header>

      {/* Transcript */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-lg space-y-4">
          {transcript.length === 0 && status === "connected" && (
            <p className="text-center text-sm text-[var(--muted)]">
              Hold the button and speak, or type a message below.
            </p>
          )}
          {transcript.map((msg, i) => (
            <div
              key={i}
              className={`flex items-end gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {/* AI avatar badge */}
              {msg.role === "ai" && (
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-bold text-teal-600">
                  AI
                </div>
              )}
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm ${
                  msg.role === "ai"
                    ? "bg-[var(--teal-tint)] text-[var(--text)]"
                    : "bg-[var(--indigo-tint)] text-[var(--text)]"
                }`}
              >
                {msg.text}
                {msg.streaming && (
                  <span className="ml-1 inline-block animate-pulse text-teal-500">
                    |
                  </span>
                )}
              </div>
              {/* User avatar badge */}
              {msg.role === "user" && (
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-600">
                  U
                </div>
              )}
            </div>
          ))}
          <div ref={transcriptEndRef} />
        </div>
      </main>

      {/* Text input (Phase 3 dev text box — kept for debugging) */}
      {status === "connected" && (
        <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div className="mx-auto flex max-w-lg gap-2">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleTextKeyDown}
              placeholder="Type a message..."
              className="flex-1 rounded-2xl border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            />
            <button
              onClick={handleSendText}
              disabled={!textInput.trim()}
              className="rounded-2xl bg-[var(--primary)] px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[var(--primary-hover)] disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Mic error display */}
      {mic.error && (
        <div className="border-t border-red-200 bg-[var(--red-tint)] px-4 py-2">
          <p className="text-center text-xs text-[var(--danger)]">
            Mic error: {mic.error}
          </p>
        </div>
      )}

      {/* Control Deck */}
      <footer className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-6 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
        <div className="flex flex-col items-center gap-3">
          {/* Status indicator */}
          <div className="flex items-center gap-2">
            <div
              className={`h-3 w-3 rounded-full transition-all ${
                isRecording
                  ? "animate-pulse bg-[var(--danger)] shadow-[0_0_12px_rgba(239,68,68,0.5)]"
                  : status === "connected"
                    ? "animate-pulse bg-[var(--primary)] shadow-[0_0_12px_rgba(34,197,94,0.5)]"
                    : status === "connecting"
                      ? "animate-pulse bg-[var(--warning)] shadow-[0_0_12px_rgba(245,158,11,0.5)]"
                      : "bg-slate-300"
              }`}
            />
            {/* AI speaking glow indicator */}
            {isAiSpeaking && (
              <span className="animate-pulse text-xs font-semibold text-[var(--secondary)]">
                AI speaking
              </span>
            )}
          </div>

          {/* Big PTT button */}
          <button
            onClick={status === "disconnected" ? handleBigButtonClick : undefined}
            onPointerDown={status === "connected" ? handlePttDown : undefined}
            onPointerUp={status === "connected" ? handlePttUp : undefined}
            onPointerCancel={status === "connected" ? handlePttUp : undefined}
            onContextMenu={(e) => e.preventDefault()}
            className={`flex h-24 w-24 select-none items-center justify-center rounded-full border-4 transition-all ${
              isRecording
                ? "scale-110 border-red-400 bg-red-50 shadow-[0_0_32px_rgba(239,68,68,0.35)]"
                : isAiSpeaking
                  ? "animate-pulse border-blue-400 bg-blue-50 shadow-[0_0_32px_rgba(59,130,246,0.35)]"
                  : status === "connected"
                    ? "border-green-400 bg-green-50 shadow-[0_0_24px_rgba(34,197,94,0.25)] hover:shadow-[0_0_32px_rgba(34,197,94,0.4)]"
                    : status === "connecting"
                      ? "border-amber-400 bg-amber-50 shadow-[0_0_24px_rgba(245,158,11,0.25)]"
                      : "border-slate-300 bg-[var(--surface)] shadow-md hover:border-slate-400 hover:shadow-lg"
            }`}
          >
            <span className="text-2xl">{micIcon}</span>
          </button>

          <span
            className={`text-xs font-medium ${isRecording ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}
          >
            {micLabel}
          </span>

          {/* End Call button when connected (since big button is now PTT) */}
          {status === "connected" && (
            <button
              onClick={() => {
                mic.stop();
                endCall();
              }}
              className="mt-1 rounded-2xl border border-red-200 bg-red-50 px-4 py-1.5 text-xs font-semibold text-[var(--danger)] transition hover:bg-red-100"
            >
              End Call
            </button>
          )}
        </div>
      </footer>

      {/* Dev debug panel — collapsible */}
      {import.meta.env.DEV && (
        <div className="border-t border-[var(--border)] bg-slate-50 px-4 py-2">
          <button
            onClick={() => setDebugOpen((o) => !o)}
            className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600"
          >
            {debugOpen ? "▼ Debug" : "▶ Debug"}
          </button>
          {debugOpen && (
            <div className="mx-auto max-w-lg">
              <div className="mb-2 flex items-center gap-3">
                <span className="text-xs font-medium text-slate-500">
                  WS: {status}
                </span>
                <button
                  onClick={() => send({ type: "client.ping" })}
                  disabled={status !== "connected"}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs text-slate-500 transition hover:shadow-sm disabled:opacity-40"
                >
                  Ping
                </button>
                <button
                  onClick={() =>
                    send({ type: "client.event", payload: { test: true } })
                  }
                  disabled={status !== "connected"}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs text-slate-500 transition hover:shadow-sm disabled:opacity-40"
                >
                  Echo test
                </button>
              </div>
              <pre className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-[10px] leading-tight text-slate-500">
                {events
                  .slice(-10)
                  .map((e) => JSON.stringify(e, null, 2))
                  .join("\n---\n") || "(no events)"}
              </pre>

              {/* Phase 7: Tool results debug display */}
              {toolResults.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs font-medium text-amber-600">
                    Tool Results ({toolResults.length})
                  </span>
                  <pre className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-amber-200 bg-[var(--amber-tint)] p-2 text-[10px] leading-tight text-amber-700">
                    {toolResults
                      .map(
                        (tr) =>
                          `[${new Date(tr.ts).toLocaleTimeString()}] ${tr.name}\n${JSON.stringify(tr.result, null, 2)}`,
                      )
                      .join("\n---\n")}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
