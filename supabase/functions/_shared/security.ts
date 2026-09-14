import type { SupabaseClient } from "@supabase/supabase-js";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-nex-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export class ClientError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders, ...(status === 429 ? { "Retry-After": "60" } : {}) },
  });
}

export async function readPayload(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new ClientError("JSON_REQUIRED", 415);
  if (Number(req.headers.get("content-length")) > 8192)
    throw new ClientError("PAYLOAD_TOO_LARGE", 413);
  const reader = req.body?.getReader();
  if (!reader) throw new ClientError("INVALID_JSON");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 8192) {
      await reader.cancel();
      throw new ClientError("PAYLOAD_TOO_LARGE", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ClientError("INVALID_JSON");
  }
}

export function stringField(value: unknown, max: number, error: string): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new ClientError(error);
  return value.trim();
}

export function emailField(value: unknown) {
  const email = stringField(value, 320, "ACCOUNT_EMAIL_REQUIRED").toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ClientError("ACCOUNT_EMAIL_REQUIRED");
  return email;
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function newSessionToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// HMAC prevents dictionary recovery of email/IP from operational rate-limit keys.
export async function privateHash(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function rateLimit(admin: SupabaseClient, key: string, limit: number, seconds = 60) {
  const { data, error } = await admin.rpc("nex_consume_rate_limit", {
    requested_key: key,
    requested_limit: limit,
    window_seconds: seconds,
  });
  if (error) throw new ClientError("SERVER_UNAVAILABLE", 503);
  if (data !== true) throw new ClientError("RATE_LIMITED", 429);
}

export async function requestLimit(
  admin: SupabaseClient,
  req: Request,
  scope: string,
  secret: string,
) {
  // Forwarded IPs are advisory; subject and global limits do not depend on them.
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim().slice(0, 128);
  await rateLimit(
    admin,
    await privateHash(`${scope}:ip:${ip}`, secret),
    scope === "admin" ? 30 : 180,
  );
  await rateLimit(
    admin,
    await privateHash(`${scope}:global`, secret),
    scope === "admin" ? 300 : 6000,
  );
}

export async function audit(
  admin: SupabaseClient,
  action: string,
  outcome: string,
  actorId: string | null = null,
) {
  // No payloads, email, IP, device, codes, keys, tokens, or raw error strings.
  const { error } = await admin
    .from("license_security_audit")
    .insert({ action, outcome, actor_id: actorId });
  if (error) throw new ClientError("AUDIT_UNAVAILABLE", 503);
}

export function errorResponse(error: unknown) {
  return error instanceof ClientError
    ? json({ ok: false, error: error.message }, error.status)
    : json({ ok: false, error: "SERVER_UNAVAILABLE" }, 503);
}
