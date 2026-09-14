import { createClient } from "@supabase/supabase-js";
import {
  audit,
  ClientError,
  corsHeaders,
  emailField,
  errorResponse,
  json,
  newSessionToken,
  privateHash,
  rateLimit,
  readPayload,
  requestLimit,
  sha256Hex,
  stringField,
} from "../_shared/security.ts";

export function validatePayload(payload: Record<string, unknown>) {
  if (!["activate", "verify", "revoke"].includes(String(payload.action)))
    throw new ClientError("INVALID_ACTION");
  const action = payload.action as "activate" | "verify" | "revoke";
  const device = payload.device as Record<string, unknown> | undefined;
  const fingerprint = stringField(device?.fingerprint, 64, "INVALID_DEVICE").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new ClientError("INVALID_DEVICE");
  const label = stringField(device?.label ?? "PC Windows", 120, "INVALID_DEVICE") || "PC Windows";
  if (action === "activate") {
    const email = emailField(payload.email);
    const code = stringField(payload.code, 128, "INVALID_CODE").toUpperCase().replace(/[- ]/g, "");
    if (!/^[A-Z0-9]{8,100}$/.test(code)) throw new ClientError("INVALID_CODE");
    return { action, email, code, fingerprint, label, sessionToken: "" };
  }
  const sessionToken = stringField(payload.sessionToken, 64, "LICENSE_SESSION_REQUIRED");
  if (!/^[a-f0-9]{64}$/.test(sessionToken)) throw new ClientError("LICENSE_SESSION_REQUIRED", 401);
  return { action, email: "", code: "", fingerprint, label, sessionToken };
}

export async function handleRequest(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 503);
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    await requestLimit(admin, req, "license", key);
    const payload = validatePayload(await readPayload(req));
    const { action, email, code, fingerprint, label } = payload;
    await rateLimit(
      admin,
      await privateHash(action + ":" + (email || payload.sessionToken), key),
      action === "activate" ? 10 : 180,
      action === "activate" ? 900 : 60,
    );
    if (action === "activate")
      await rateLimit(admin, await privateHash("code:" + code, key), 10, 900);
    const token = action === "activate" ? newSessionToken() : payload.sessionToken;
    const tokenHash = await sha256Hex(token);
    const rpc =
      action === "activate"
        ? "nex_activate_license_session"
        : action === "verify"
          ? "nex_verify_license_session"
          : "nex_revoke_license_session";
    const args =
      action === "activate"
        ? {
            requested_email: email,
            redemption_code: code,
            device_fingerprint: fingerprint,
            requested_device_label: label,
            requested_token_hash: tokenHash,
          }
        : { requested_token_hash: tokenHash, device_fingerprint: fingerprint };
    const { data, error } = await admin.rpc(rpc, args);
    if (error) {
      await audit(admin, action, "denied");
      // Do not expose SQL internals, account existence, or code ownership.
      throw new ClientError(
        action === "activate" ? "ACTIVATION_DENIED" : "LICENSE_SESSION_INVALID",
        403,
      );
    }
    if (action === "revoke") return json({ ok: true });
    const result = data as Record<string, unknown> | null;
    if (!result?.ok) throw new ClientError("LICENSE_SESSION_INVALID", 401);
    if (action === "activate") result.session = { ...(result.session as object), token };
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

if (import.meta.main) Deno.serve(handleRequest);
