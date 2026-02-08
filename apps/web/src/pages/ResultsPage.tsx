import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";

const REALTIME_URL =
  import.meta.env.VITE_REALTIME_URL ?? "http://127.0.0.1:8787";

interface ToolResultEntry {
  name: string;
  result: Record<string, unknown>;
  at: string;
}

interface CriteriaScore {
  name: string;
  score: number;
  notes: string;
}

interface GradeResult {
  ok?: boolean;
  score?: number;
  criteria_scores?: CriteriaScore[];
  missed_targets?: string[];
  summary?: string;
  tips?: string[];
}

interface QuizQuestion {
  question: string;
  options: string[];
  answer: string;
}

interface QuizData {
  title?: string;
  questions?: QuizQuestion[];
}

interface QuizResult {
  ok?: boolean;
  quiz?: QuizData;
}

interface SessionProgress {
  completed: boolean;
  completionScore: number | null;
  completedAt: string | null;
}

interface SessionSummary {
  sessionKey: string | null;
  scenarioId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  toolResults: ToolResultEntry[];
  transcriptExcerpt?: { role: string; text: string; at: string }[];
  progress?: SessionProgress;
  grade?: GradeResult | null;
  quiz?: QuizResult | null;
}

function criterionLabel(name: string): string {
  switch (name) {
    case "pronunciation_fluency":
      return "Pronunciation & Fluency";
    case "accuracy":
      return "Accuracy";
    case "confidence":
      return "Confidence";
    default:
      return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

function scoreColor(score: number): string {
  if (score >= 90) return "text-green-400";
  if (score >= 75) return "text-amber-400";
  return "text-red-400";
}

function scoreBgColor(score: number): string {
  if (score >= 90) return "bg-green-500";
  if (score >= 75) return "bg-amber-500";
  return "bg-red-500";
}

export function ResultsPage() {
  const { sessionKey } = useParams<{ sessionKey: string }>();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quiz interactive state
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

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

  const selectAnswer = useCallback(
    (questionIdx: number, option: string) => {
      if (quizSubmitted) return;
      setQuizAnswers((prev) => ({ ...prev, [questionIdx]: option }));
    },
    [quizSubmitted],
  );

  const handleQuizSubmit = useCallback(() => {
    setQuizSubmitted(true);
  }, []);

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

  // Phase 9B: Use top-level grade/quiz fields (fall back to toolResults)
  const grade: GradeResult | undefined =
    (summary.grade as GradeResult) ??
    ([...summary.toolResults]
      .reverse()
      .find((tr) => tr.name === "grade_lesson")?.result as
      | GradeResult
      | undefined);

  const quizResult: QuizResult | undefined =
    (summary.quiz as QuizResult) ??
    ([...summary.toolResults]
      .reverse()
      .find((tr) => tr.name === "trigger_quiz")?.result as
      | QuizResult
      | undefined);
  const quiz = quizResult?.quiz;

  // Quiz scoring
  const quizQuestions = quiz?.questions ?? [];
  const quizScore = quizSubmitted
    ? quizQuestions.reduce(
        (acc, q, i) => acc + (quizAnswers[i] === q.answer ? 1 : 0),
        0,
      )
    : null;

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
        {/* Phase 9B: Progress badge */}
        {summary.progress?.completed && (
          <span className="mt-1 inline-block rounded-full bg-green-900/50 px-2 py-0.5 text-xs text-green-400">
            Completed
          </span>
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
                  className={`text-4xl font-bold ${scoreColor(grade.score)}`}
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

            {/* Phase 9B: Criteria Breakdown */}
            {grade.criteria_scores && grade.criteria_scores.length > 0 && (
              <div className="mb-4">
                <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-teal-400">
                  Criteria Breakdown
                </h3>
                <div className="space-y-3">
                  {grade.criteria_scores.map((cs) => (
                    <div
                      key={cs.name}
                      className="rounded-lg border border-gray-800 bg-gray-900/50 p-3"
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-200">
                          {criterionLabel(cs.name)}
                        </span>
                        <span
                          className={`text-sm font-bold ${scoreColor(cs.score)}`}
                        >
                          {cs.score}
                        </span>
                      </div>
                      {/* Score bar */}
                      <div className="mb-1 h-1.5 w-full rounded-full bg-gray-800">
                        <div
                          className={`h-1.5 rounded-full ${scoreBgColor(cs.score)}`}
                          style={{ width: `${cs.score}%` }}
                        />
                      </div>
                      {cs.notes && (
                        <p className="text-xs text-gray-500">{cs.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Missed targets */}
            {grade.missed_targets && grade.missed_targets.length > 0 && (
              <div className="mb-4">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-teal-400">
                  Missed Phrases
                </h3>
                <div className="flex flex-wrap gap-2">
                  {grade.missed_targets.map((t) => (
                    <span
                      key={t}
                      className="rounded-full border border-amber-800/50 bg-amber-950/30 px-2 py-0.5 text-xs text-amber-400"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
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

        {/* Quiz Section — Phase 9B interactive */}
        {quiz && quizQuestions.length > 0 && (
          <section className="rounded-xl border border-indigo-800/50 bg-indigo-950/30 p-6">
            <h2 className="mb-4 text-base font-semibold text-indigo-300">
              {quiz.title ?? "Quiz"}
            </h2>

            {/* Quiz score after submit */}
            {quizSubmitted && quizScore !== null && (
              <div className="mb-4 rounded-lg border border-indigo-700/50 bg-indigo-900/30 p-3 text-center">
                <span
                  className={`text-2xl font-bold ${scoreColor(Math.round((quizScore / quizQuestions.length) * 100))}`}
                >
                  {quizScore} / {quizQuestions.length}
                </span>
                <p className="mt-1 text-xs text-gray-400">
                  {quizScore === quizQuestions.length
                    ? "Perfect score!"
                    : quizScore >= quizQuestions.length / 2
                      ? "Good effort — review the highlighted answers."
                      : "Keep studying — you'll improve!"}
                </p>
              </div>
            )}

            <ol className="space-y-4">
              {quizQuestions.map((q, i) => {
                const selected = quizAnswers[i];
                const isCorrect = selected === q.answer;

                return (
                  <li key={i}>
                    <p className="mb-2 text-sm font-medium text-gray-200">
                      {i + 1}. {q.question}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {q.options.map((opt) => {
                        let classes =
                          "rounded-lg border px-3 py-1.5 text-sm cursor-pointer transition ";
                        if (quizSubmitted) {
                          if (opt === q.answer) {
                            classes +=
                              "border-green-600 bg-green-950/40 text-green-300";
                          } else if (opt === selected && !isCorrect) {
                            classes +=
                              "border-red-600 bg-red-950/40 text-red-300";
                          } else {
                            classes += "border-gray-700 text-gray-500";
                          }
                        } else if (opt === selected) {
                          classes +=
                            "border-indigo-500 bg-indigo-900/40 text-indigo-200";
                        } else {
                          classes +=
                            "border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300";
                        }

                        return (
                          <button
                            key={opt}
                            type="button"
                            className={classes}
                            onClick={() => selectAnswer(i, opt)}
                            disabled={quizSubmitted}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
            </ol>

            {/* Submit button */}
            {!quizSubmitted && (
              <button
                type="button"
                onClick={handleQuizSubmit}
                disabled={Object.keys(quizAnswers).length < quizQuestions.length}
                className="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Submit Quiz
              </button>
            )}
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
