/**
 * Phase 7 — In-memory tool execution for the Durable Object.
 * Phase 9B — Deterministic grading using scenario rubric + transcript.
 *
 * Each handler receives the parsed arguments and a minimal context object.
 * Results are plain objects that will be JSON-stringified and sent back to
 * OpenAI as function_call_output.
 */

import type { GradingRubric } from "@shared";

/** Transcript entry passed from the DO for grading context */
export interface TranscriptItem {
  role: "user" | "ai";
  text: string;
  at: string;
}

export interface ToolContext {
  scenarioId?: string;
  sessionId: string;
  /** Phase 9B: transcript excerpt for grading */
  transcript?: TranscriptItem[];
  /** Phase 9B: scenario target phrases for matching */
  targetPhrases?: string[];
  /** Phase 9B: grading rubric from scenario */
  rubric?: GradingRubric;
}

type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<Record<string, unknown>>;

// ── Common English words used to detect language leakage ─────
const COMMON_ENGLISH_WORDS = new Set([
  "the", "is", "are", "was", "were", "have", "has", "do", "does",
  "can", "could", "would", "should", "will", "what", "where", "when",
  "how", "why", "this", "that", "with", "from", "they", "them",
  "i", "you", "he", "she", "we", "my", "your", "his", "her",
  "want", "need", "like", "know", "think", "just", "very", "really",
  "because", "about", "some", "also", "but", "not", "yes", "no",
  "hello", "sorry", "okay", "right", "well", "so", "and", "or",
]);

// ── Individual tool implementations ──────────────────────────

interface CriteriaScore {
  name: string;
  score: number;
  notes: string;
}

const gradeLesson: ToolHandler = async (args, ctx) => {
  const topic =
    typeof args.topic === "string" ? args.topic : "general conversation";
  const transcript = ctx.transcript ?? [];
  const targetPhrases = ctx.targetPhrases ?? [];
  const rubric = ctx.rubric;

  // Extract user utterances
  const userUtterances = transcript
    .filter((t) => t.role === "user")
    .map((t) => t.text);
  const userText = userUtterances.join(" ").toLowerCase();
  const userWordCount = userText.split(/\s+/).filter(Boolean).length;
  const utteranceCount = userUtterances.length;

  // ── 1) Participation score (0-100) ──────────────────────
  // More utterances = higher participation; cap at 10 for max
  const participationRaw = Math.min(utteranceCount / 10, 1.0);
  const participationScore = Math.round(40 + participationRaw * 60);

  // ── 2) Target phrase matching (0-100) ───────────────────
  const matchedTargets: string[] = [];
  const missedTargets: string[] = [];
  for (const phrase of targetPhrases) {
    if (userText.includes(phrase.toLowerCase())) {
      matchedTargets.push(phrase);
    } else {
      missedTargets.push(phrase);
    }
  }
  const targetRatio =
    targetPhrases.length > 0
      ? matchedTargets.length / targetPhrases.length
      : 0.5; // no targets defined → neutral
  const targetScore = Math.round(30 + targetRatio * 70);

  // ── 3) English leakage penalty ──────────────────────────
  // Count English words in user text
  const words = userText.split(/\s+/).filter(Boolean);
  let englishCount = 0;
  for (const w of words) {
    if (COMMON_ENGLISH_WORDS.has(w)) {
      englishCount++;
    }
  }
  const englishRatio = userWordCount > 0 ? englishCount / userWordCount : 0;
  // Penalty: heavy English = lower score
  const leakagePenalty = Math.min(englishRatio * 80, 40); // max 40 point penalty

  // ── 4) Confidence proxy ─────────────────────────────────
  // Average utterance length as a confidence proxy
  const avgUtteranceLength =
    utteranceCount > 0
      ? userUtterances.reduce((sum, u) => sum + u.length, 0) / utteranceCount
      : 0;
  // Longer utterances suggest more confidence; cap at 60 chars
  const confidenceRaw = Math.min(avgUtteranceLength / 60, 1.0);
  const confidenceScore = Math.round(40 + confidenceRaw * 60);

  // ── 5) Map into rubric criteria ─────────────────────────
  const criteriaScores: CriteriaScore[] = [];
  let weightedTotal = 0;
  let totalWeight = 0;

  if (rubric && rubric.criteria.length > 0) {
    for (const criterion of rubric.criteria) {
      let rawScore: number;
      let notes: string;

      switch (criterion.name) {
        case "pronunciation_fluency":
          // Combines participation and leakage
          rawScore = Math.max(
            0,
            Math.round(participationScore - leakagePenalty),
          );
          notes =
            utteranceCount > 5
              ? `Good conversational flow with ${utteranceCount} exchanges.`
              : `Limited interaction (${utteranceCount} exchanges). Try to speak more.`;
          if (leakagePenalty > 15) {
            notes += " Some English words detected — try to stay in Spanish.";
          }
          break;

        case "accuracy":
          rawScore = targetScore;
          notes =
            matchedTargets.length > 0
              ? `Used ${matchedTargets.length}/${targetPhrases.length} target phrases: ${matchedTargets.join(", ")}.`
              : "No target phrases detected. Try using key vocabulary from the lesson.";
          break;

        case "confidence":
          rawScore = confidenceScore;
          notes =
            avgUtteranceLength > 30
              ? "Formed complete sentences — great confidence."
              : "Responses were short. Try forming longer sentences.";
          break;

        default:
          // Generic fallback for any custom criteria
          rawScore = Math.round(
            (participationScore + targetScore + confidenceScore) / 3 -
              leakagePenalty / 3,
          );
          notes = `Score based on overall performance for "${criterion.name}".`;
      }

      rawScore = Math.max(0, Math.min(100, rawScore));
      criteriaScores.push({ name: criterion.name, score: rawScore, notes });
      weightedTotal += rawScore * criterion.weight;
      totalWeight += criterion.weight;
    }
  } else {
    // No rubric — simple average
    const simple = Math.round(
      (participationScore + targetScore + confidenceScore) / 3 -
        leakagePenalty / 3,
    );
    criteriaScores.push({
      name: "overall",
      score: Math.max(0, Math.min(100, simple)),
      notes: "No rubric defined; scored on participation, targets, and confidence.",
    });
    weightedTotal = simple;
    totalWeight = 1;
  }

  const finalScore = Math.max(
    0,
    Math.min(100, Math.round(weightedTotal / (totalWeight || 1))),
  );

  // ── Build tips ──────────────────────────────────────────
  const tips: string[] = [];
  if (missedTargets.length > 0) {
    tips.push(
      `Try using these phrases next time: ${missedTargets.slice(0, 3).join(", ")}.`,
    );
  }
  if (leakagePenalty > 10) {
    tips.push(
      "Reduce English usage — try to express yourself fully in Spanish.",
    );
  }
  if (utteranceCount < 5) {
    tips.push("Engage more in conversation — longer practice helps retention.");
  }
  if (avgUtteranceLength < 20) {
    tips.push(
      "Try forming complete sentences instead of single words or short phrases.",
    );
  }
  if (tips.length === 0) {
    tips.push("Keep practicing to maintain your skills!");
  }

  // ── Summary ─────────────────────────────────────────────
  const summary =
    `Student scored ${finalScore}/100 on "${topic}". ` +
    `Used ${matchedTargets.length}/${targetPhrases.length} target phrases. ` +
    `${utteranceCount} exchanges with ${englishCount > 0 ? `${englishCount} English words detected` : "no English leakage"}.`;

  return {
    ok: true,
    score: finalScore,
    criteria_scores: criteriaScores,
    missed_targets: missedTargets,
    summary,
    tips,
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
