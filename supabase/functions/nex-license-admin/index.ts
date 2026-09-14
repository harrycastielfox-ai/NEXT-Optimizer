import { createClient } from "@supabase/supabase-js";
import {
  audit,
  ClientError,
  corsHeaders,
  emailField,
  errorResponse,
  json,
  privateHash,
  rateLimit,
  readPayload,
  requestLimit,
  sha256Hex,
  stringField,
} from "../_shared/security.ts";

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function validateAdminPayload(payload: Record<string, unknown>) {
  const action = stringField(payload.action, 32, "INVALID_ACTION");
  const allowed = [
    "create_code",
    "list_codes",
    "list_transfers",
    "review_transfer",
    "revoke_license",
    "transfer_license",
  ];
  if (!allowed.includes(action)) throw new ClientError("INVALID_ACTION");
  const note = payload.note == null ? null : stringField(payload.note, 500, "INVALID_NOTE");
  if (action === "create_code") {
    const planId = stringField(payload.planId, 32, "INVALID_PLAN");
    if (!["15_days", "30_days", "3_months", "6_months", "1_year"].includes(planId))
      throw new ClientError("INVALID_PLAN");
    const assignedEmail = emailField(payload.assignedEmail);
    const expiresAt =
      payload.expiresAt == null ? null : stringField(payload.expiresAt, 40, "INVALID_EXPIRATION");
    if (
      expiresAt &&
      (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())
    )
      throw new ClientError("INVALID_EXPIRATION");
    return { action, planId, assignedEmail, expiresAt, note };
  }
  if (action === "review_transfer") {
    const transferId = stringField(payload.transferId, 36, "INVALID_REVIEW_REQUEST");
    if (
      !uuidPattern.test(transferId) ||
      !["approved", "rejected"].includes(String(payload.decision))
    )
      throw new ClientError("INVALID_REVIEW_REQUEST");
    return { action, transferId, decision: payload.decision as string, note };
  }
  if (action === "revoke_license" || action === "transfer_license") {
    const accountId = stringField(payload.accountId, 36, "INVALID_ACCOUNT_ID");
    if (!uuidPattern.test(accountId)) throw new ClientError("INVALID_ACCOUNT_ID");
    if (action === "revoke_license") return { action, accountId };
    const code = stringField(payload.originalCode, 128, "INVALID_CODE")
      .toUpperCase()
      .replace(/[- ]/g, "");
    const fingerprint = stringField(
      payload.newDeviceFingerprint,
      64,
      "INVALID_DEVICE",
    ).toLowerCase();
    const label = stringField(payload.newDeviceLabel, 120, "INVALID_DEVICE");
    if (!/^[A-Z0-9]{8,100}$/.test(code) || !/^[a-f0-9]{64}$/.test(fingerprint))
      throw new ClientError("INVALID_TRANSFER");
    return { action, accountId, code, fingerprint, label };
  }
  return { action };
}

export async function handleRequest(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !secret) return json({ ok: false, error: "SERVER_NOT_CONFIGURED" }, 503);
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    await requestLimit(admin, req, "admin", secret);
    const key = stringField(req.headers.get("x-nex-admin-key"), 256, "ADMIN_KEY_REQUIRED");
    if (key.length < 32) throw new ClientError("ADMIN_KEY_REQUIRED", 401);
    const keyHash = await sha256Hex(key);
    await rateLimit(admin, await privateHash("admin:key:" + keyHash, secret), 60);
    const { data: actor, error: lookupError } = await admin
      .from("license_admin_keys")
      .select("id,label,actor_email")
      .eq("key_hash", keyHash)
      .eq("active", true)
      .maybeSingle();
    if (lookupError) throw new ClientError("SERVER_UNAVAILABLE", 503);
    if (!actor) {
      await audit(admin, "admin", "denied");
      throw new ClientError("ADMIN_NOT_ALLOWED", 403);
    }
    const payload = validateAdminPayload(await readPayload(req));
    // Audit before mutations; inability to retain an audit record fails closed.
    await audit(admin, "admin", "allowed", actor.id);
    await admin
      .from("license_admin_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", actor.id);
    const view = { admin: { label: actor.label } };
    if (payload.action === "list_transfers") {
      const { data, error } = await admin
        .from("device_transfer_requests")
        .select("id,user_id,requested_device_label,status,requested_at,reviewed_at,review_note")
        .in("status", ["pending", "approved", "rejected", "expired"])
        .order("requested_at", { ascending: false })
        .limit(100);
      if (error) throw new ClientError("OPERATION_FAILED", 503);
      return json({ ...view, transfers: data ?? [] });
    }
    if (payload.action === "list_codes") {
      const { data, error } = await admin
        .from("license_codes")
        .select("id,plan_id,status,created_at,redeemed_at,expires_at,note")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw new ClientError("OPERATION_FAILED", 503);
      return json({ ...view, codes: data ?? [] });
    }
    const { rpc, args } =
      payload.action === "create_code"
        ? {
            rpc: "admin_create_license_code",
            args: {
              requested_plan_id: payload.planId,
              assigned_email: payload.assignedEmail,
              actor_email: actor.actor_email,
              code_expires_at: payload.expiresAt,
              code_note: payload.note,
            },
          }
        : payload.action === "review_transfer"
          ? {
              rpc: "admin_review_device_transfer",
              args: {
                transfer_request_id: payload.transferId,
                transfer_decision: payload.decision,
                actor_email: actor.actor_email,
                reviewer_note: payload.note,
              },
            }
          : payload.action === "transfer_license"
            ? {
                rpc: "nex_admin_transfer_email_license",
                args: {
                  target_account_id: payload.accountId,
                  requested_actor_id: actor.id,
                  original_code: payload.code,
                  new_device_hash: payload.fingerprint,
                  new_device_label: payload.label,
                },
              }
            : {
                rpc: "nex_admin_revoke_email_license",
                args: { target_account_id: payload.accountId, requested_actor_id: actor.id },
              };
    const { data, error } = await admin.rpc(rpc, args);
    if (error) throw new ClientError("OPERATION_DENIED", 403);
    return json({
      ...view,
      ...(payload.action === "create_code"
        ? { code: Array.isArray(data) ? data[0] : data }
        : { result: data }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

if (import.meta.main) Deno.serve(handleRequest);
