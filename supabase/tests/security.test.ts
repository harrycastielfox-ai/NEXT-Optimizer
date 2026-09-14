// No server, credentials, database or network calls: all effects are test doubles.
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validatePayload, handleRequest } from "../functions/nex-license-session/index.ts";
import { validateAdminPayload } from "../functions/nex-license-admin/index.ts";
import {
  ClientError,
  readPayload,
  stringField,
  newSessionToken,
  sha256Hex,
  privateHash,
  rateLimit,
  audit,
  errorResponse,
} from "../functions/_shared/security.ts";

const fingerprint = "a".repeat(64);
const token = "b".repeat(64);
const device = { fingerprint, label: "Test PC" };
const request = (body: string, headers = {}) =>
  new Request("https://example.invalid", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

Deno.test("email alone and forged access claims cannot verify a session", () => {
  for (const payload of [
    { action: "verify", email: "buyer@example.com", device },
    { action: "verify", device, access: "allowed", entitlement: { status: "active" } },
    { action: "login", device },
    { action: "verify", device, sessionToken: "b".repeat(63) },
    { action: "verify", device: { fingerprint: "fake" }, sessionToken: token },
  ])
    assert.throws(() => validatePayload(payload), ClientError);
  assert.equal(
    validatePayload({ action: "verify", device, sessionToken: token }).sessionToken,
    token,
  );
});

Deno.test("activation normalizes email/code and requires a bound native identity", () => {
  const result = validatePayload({
    action: "activate",
    email: " BUYER@EXAMPLE.COM ",
    code: "NEX-12345-ABCDE",
    device,
  });
  assert.equal(result.email, "buyer@example.com");
  assert.equal(result.code, "NEX12345ABCDE");
  assert.throws(() =>
    validatePayload({ action: "activate", email: "buyer@example.com", code: "NEX-12345-ABCDE" }),
  );
});

Deno.test("request body is bounded even without Content-Length", async () => {
  assert.deepEqual(await readPayload(request('{"action":"verify"}')), { action: "verify" });
  for (const value of ["null", "[]", "true", "{broken"])
    await assert.rejects(readPayload(request(value)), /INVALID_JSON/);
  await assert.rejects(
    readPayload(request(JSON.stringify({ value: "x".repeat(8192) }))),
    /PAYLOAD_TOO_LARGE/,
  );
  await assert.rejects(
    readPayload(request("{}", { "content-length": "8193" })),
    /PAYLOAD_TOO_LARGE/,
  );
  await assert.rejects(
    readPayload(request("{}", { "content-type": "text/plain" })),
    /JSON_REQUIRED/,
  );
});

Deno.test(
  "control characters, oversized fields and unknown administrative actions fail closed",
  () => {
    for (const value of [null, {}, "a\n", "a\u0000", "a\u007f", "x".repeat(501)])
      assert.throws(() => stringField(value, 500, "BAD_FIELD"));
    for (const payload of [
      { action: "sql" },
      { action: "create_code", planId: "lifetime", assignedEmail: "a@example.com" },
      { action: "revoke_license", userId: "11111111-1111-4111-8111-111111111111" },
      {
        action: "transfer_license",
        accountId: "11111111-1111-4111-8111-111111111111",
        newDeviceFingerprint: fingerprint,
      },
      {
        action: "review_transfer",
        transferId: "11111111-1111-4111-8111-111111111111",
        decision: "arbitrary",
      },
    ])
      assert.throws(() => validateAdminPayload(payload), ClientError);
    assert.equal(
      validateAdminPayload({
        action: "create_code",
        planId: "30_days",
        assignedEmail: "a@example.com",
      }).action,
      "create_code",
    );
  },
);

Deno.test("tokens are random 256-bit values and identifiers use keyed hashes", async () => {
  const tokens = new Set(Array.from({ length: 100 }, newSessionToken));
  assert.equal(tokens.size, 100);
  for (const value of tokens) assert.match(value, /^[a-f0-9]{64}$/);
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.notEqual(
    await privateHash("a@example.com", "test-key-1"),
    await privateHash("a@example.com", "test-key-2"),
  );
});

Deno.test("rate limits use persistent RPC and database failures deny access", async () => {
  const calls: unknown[] = [];
  const fake = (data: unknown, error: unknown = null) =>
    ({
      rpc: (name: string, args: unknown) => {
        calls.push([name, args]);
        return Promise.resolve({ data, error });
      },
    }) as unknown as SupabaseClient;
  await rateLimit(fake(true), token, 10, 900);
  assert.deepEqual(calls[0], [
    "nex_consume_rate_limit",
    { requested_key: token, requested_limit: 10, window_seconds: 900 },
  ]);
  await assert.rejects(rateLimit(fake(false), token, 10), /RATE_LIMITED/);
  await assert.rejects(
    rateLimit(fake(true, { message: "private SQL" }), token, 10),
    /SERVER_UNAVAILABLE/,
  );
});

Deno.test("audit failure denies mutations and raw errors are not returned", async () => {
  const fake = {
    from: () => ({ insert: () => Promise.resolve({ error: { message: "private SQL" } }) }),
  } as unknown as SupabaseClient;
  await assert.rejects(audit(fake, "admin", "allowed"), /AUDIT_UNAVAILABLE/);
  const response = errorResponse(new Error("private token=secret SQL"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: false, error: "SERVER_UNAVAILABLE" });
  assert.equal(
    errorResponse(new ClientError("RATE_LIMITED", 429)).headers.get("retry-after"),
    "60",
  );
});

Deno.test("preflight and unsupported methods need no privileged environment access", async () => {
  assert.equal(
    (await handleRequest(new Request("https://example.invalid", { method: "OPTIONS" }))).status,
    200,
  );
  assert.equal((await handleRequest(new Request("https://example.invalid"))).status, 405);
});
