export function safeParseJson<T = unknown>(
  raw: string,
): { ok: true; data: T } | { ok: false; error: SyntaxError } {
  try {
    return { ok: true, data: JSON.parse(raw) as T };
  } catch (e) {
    return { ok: false, error: e as SyntaxError };
  }
}
