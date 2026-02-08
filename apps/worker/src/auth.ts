/**
 * Phase 9A: Lightweight JWT-like token minting and validation.
 *
 * Token format:  base64url(header).base64url(payload).base64url(signature)
 * Signature:     HMAC-SHA256(header.payload, SESSION_SIGNING_SECRET)
 */

// ── Base64url helpers ───────────────────────────────────────────
function base64urlEncode(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlEncodeString(str: string): string {
  return base64urlEncode(new TextEncoder().encode(str));
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── Token payload type ──────────────────────────────────────────
export interface TokenPayload {
  sessionKey: string;
  scenarioId: string;
  exp: number; // unix seconds
}

// ── HMAC-SHA256 signing ────────────────────────────────────────
async function hmacSign(
  data: string,
  secret: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return new Uint8Array(sig);
}

async function hmacVerify(
  data: string,
  signature: Uint8Array,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(data),
  );
}

// ── Mint token ─────────────────────────────────────────────────
export async function mintToken(
  payload: TokenPayload,
  secret: string,
): Promise<string> {
  const header = base64urlEncodeString(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64urlEncodeString(JSON.stringify(payload));
  const sigInput = `${header}.${body}`;
  const sig = await hmacSign(sigInput, secret);
  return `${sigInput}.${base64urlEncode(sig)}`;
}

// ── Validate token ─────────────────────────────────────────────
export interface TokenValidationResult {
  valid: boolean;
  payload?: TokenPayload;
  error?: string;
}

export async function validateToken(
  token: string,
  secret: string,
): Promise<TokenValidationResult> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Malformed token" };
  }

  const [header, body, sig] = parts;
  const sigInput = `${header}.${body}`;

  // Verify signature
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64urlDecode(sig);
  } catch {
    return { valid: false, error: "Invalid signature encoding" };
  }

  const isValid = await hmacVerify(sigInput, sigBytes, secret);
  if (!isValid) {
    return { valid: false, error: "Invalid signature" };
  }

  // Decode payload
  let payload: TokenPayload;
  try {
    const decoded = new TextDecoder().decode(base64urlDecode(body));
    payload = JSON.parse(decoded);
  } catch {
    return { valid: false, error: "Invalid payload encoding" };
  }

  // Check expiration
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < nowSeconds) {
    return { valid: false, error: "Token expired" };
  }

  return { valid: true, payload };
}
