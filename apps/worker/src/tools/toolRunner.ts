/**
 * Phase 7 — In-memory tool execution for the Durable Object.
 *
 * Each handler receives the parsed arguments and a minimal context object.
 * Results are plain objects that will be JSON-stringified and sent back to
 * OpenAI as function_call_output.
 *
 * No database yet — all results are computed in-memory.
 */

export interface ToolContext {
  scenarioId?: string;
  sessionId: string;
}

type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<Record<string, unknown>>;

// ── Individual tool implementations ──────────────────────────

const gradeLesson: ToolHandler = async (args, _ctx) => {
  // In a real implementation this would evaluate the conversation history
  // against rubric criteria. For now return a plausible in-memory result.
  const topic =
    typeof args.topic === "string" ? args.topic : "general conversation";
  const score = Math.floor(Math.random() * 31) + 70; // 70-100

  return {
    ok: true,
    score,
    summary: `The student demonstrated good effort on "${topic}". Vocabulary usage was appropriate for the level.`,
    tips: [
      "Try using more connectors like 'porque' and 'pero'.",
      "Practice verb conjugation in the present tense.",
      "Great pronunciation — keep it up!",
    ],
  };
};

const triggerQuiz: ToolHandler = async (args, _ctx) => {
  const topic =
    typeof args.topic === "string" ? args.topic : "vocabulary review";
  const numQuestions =
    typeof args.num_questions === "number" ? args.num_questions : 3;

  // Static question bank — enough to exercise the flow end-to-end
  const questionBank = [
    {
      question: "¿Cómo se dice 'coffee' en español?",
      options: ["café", "leche", "agua", "jugo"],
      answer: "café",
    },
    {
      question: "¿Cuál es el artículo correcto? ___ mesa",
      options: ["el", "la", "los", "las"],
      answer: "la",
    },
    {
      question: "¿Qué significa 'por favor'?",
      options: ["thank you", "please", "sorry", "goodbye"],
      answer: "please",
    },
    {
      question: "Completa: Yo ___ estudiante.",
      options: ["es", "soy", "eres", "son"],
      answer: "soy",
    },
    {
      question: "¿Cómo se dice 'good morning'?",
      options: ["buenas noches", "buenas tardes", "buenos días", "hola"],
      answer: "buenos días",
    },
  ];

  const questions = questionBank.slice(0, Math.min(numQuestions, questionBank.length));

  return {
    ok: true,
    quiz: {
      title: `Quiz: ${topic}`,
      questions,
    },
  };
};

// ── Handler registry ─────────────────────────────────────────

const handlers: Record<string, ToolHandler> = {
  grade_lesson: gradeLesson,
  trigger_quiz: triggerQuiz,
};

// ── Public API ───────────────────────────────────────────────

export async function runTool(
  name: string,
  args: unknown,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const handler = handlers[name];
  if (!handler) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }

  const parsedArgs: Record<string, unknown> =
    typeof args === "string" ? safeJsonParse(args) : (args as Record<string, unknown>) ?? {};

  try {
    return await handler(parsedArgs, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Tool "${name}" failed: ${message}` };
  }
}

// ── Helpers ──────────────────────────────────────────────────

function safeJsonParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
