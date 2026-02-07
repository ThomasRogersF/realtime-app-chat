import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

const REALTIME_URL =
  import.meta.env.VITE_REALTIME_URL ?? "http://127.0.0.1:8787";

interface ToolResultEntry {
  name: string;
  result: Record<string, unknown>;
  at: string;
}

interface SessionSummary {
  sessionKey: string | null;
  scenarioId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  toolResults: ToolResultEntry[];
}

export function ResultsPage() {
  const { sessionKey } = useParams<{ sessionKey: string }>();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionKey) {
      setError("No session key provided");
      setLoading(false);
      return;
    }

    fetch(`${REALTIME_URL}/session/${sessionKey}/summary`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<SessionSummary>;
      })
      .then(setSummary)
      .catch((err) =>
        setError(
          `Failed to load results: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
      .finally(() => setLoading(false));
  }, [sessionKey]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-gray-400">Loading results...</p>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-gray-400">{error ?? "No results found."}</p>
        <button
          onClick={() => navigate("/")}
          className="rounded bg-gray-800 px-4 py-2 text-sm transition hover:bg-gray-700"
        >
          Back to Menu
        </button>
      </div>
    );
  }

  // Find latest grade_lesson result
  const gradeEntry = [...summary.toolResults]
    .reverse()
    .find((tr) => tr.name === "grade_lesson");
  const grade = gradeEntry?.result as
    | { score?: number; summary?: string; tips?: string[] }
    | undefined;

  // Find latest trigger_quiz result
  const quizEntry = [...summary.toolResults]
    .reverse()
    .find((tr) => tr.name === "trigger_quiz");
  const quiz = (quizEntry?.result as { quiz?: { title?: string; questions?: Array<{
    question: string;
    options: string[];
    answer: string;
  }> } } | undefined)?.quiz;

  return (
    <div className="flex min-h-screen flex-col bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <h1 className="text-lg font-semibold">Session Results</h1>
        {summary.scenarioId && (
          <p className="text-sm text-gray-500">
            Scenario: {summary.scenarioId}
          </p>
        )}
        {summary.startedAt && summary.endedAt && (
          <p className="text-xs text-gray-600">
            {new Date(summary.startedAt).toLocaleTimeString()} &mdash;{" "}
            {new Date(summary.endedAt).toLocaleTimeString()}
          </p>
        )}
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-6 py-8">
        {/* Grade Section */}
        {grade && (
          <section className="rounded-xl border border-teal-800/50 bg-teal-950/30 p-6">
            <h2 className="mb-4 text-base font-semibold text-teal-300">
              Lesson Grade
            </h2>

            {/* Score */}
            {typeof grade.score === "number" && (
              <div className="mb-4 flex items-baseline gap-3">
                <span
                  className={`text-4xl font-bold ${
                    grade.score >= 90
                      ? "text-green-400"
                      : grade.score >= 75
                        ? "text-amber-400"
                        : "text-red-400"
                  }`}
                >
                  {grade.score}
                </span>
                <span className="text-sm text-gray-500">/ 100</span>
              </div>
            )}

            {/* Summary */}
            {grade.summary && (
              <p className="mb-4 text-sm text-gray-300">{grade.summary}</p>
            )}

            {/* Tips */}
            {grade.tips && grade.tips.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-teal-400">
                  Tips
                </h3>
                <ul className="space-y-1">
                  {grade.tips.map((tip, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-gray-400"
                    >
                      <span className="mt-0.5 text-teal-500">&bull;</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* Quiz Section */}
        {quiz && quiz.questions && quiz.questions.length > 0 && (
          <section className="rounded-xl border border-indigo-800/50 bg-indigo-950/30 p-6">
            <h2 className="mb-4 text-base font-semibold text-indigo-300">
              {quiz.title ?? "Quiz"}
            </h2>
            <ol className="space-y-4">
              {quiz.questions.map((q, i) => (
                <li key={i}>
                  <p className="mb-2 text-sm font-medium text-gray-200">
                    {i + 1}. {q.question}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {q.options.map((opt) => (
                      <div
                        key={opt}
                        className={`rounded-lg border px-3 py-1.5 text-sm ${
                          opt === q.answer
                            ? "border-green-600 bg-green-950/40 text-green-300"
                            : "border-gray-700 text-gray-500"
                        }`}
                      >
                        {opt}
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* No results fallback */}
        {!grade && !quiz && (
          <div className="rounded-xl border border-gray-800 p-6 text-center">
            <p className="text-sm text-gray-500">
              No grade or quiz results were recorded for this session.
            </p>
          </div>
        )}
      </main>

      {/* Footer actions */}
      <footer className="border-t border-gray-800 px-6 py-4">
        <div className="mx-auto flex max-w-2xl gap-3">
          <button
            onClick={() => navigate("/")}
            className="flex-1 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition hover:bg-gray-800"
          >
            Back to Menu
          </button>
          {summary.scenarioId && (
            <button
              onClick={() => navigate(`/call/${summary.scenarioId}`)}
              className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-500"
            >
              Retry Scenario
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
