// Explicit live API test. Prints only fixture identifiers/hashes, never credentials.
// An authorized operator inserts the printed temporary key hash, then sends
// {"ready":true} on stdin. Remove exactly these fixtures after completion/failure.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";

assert.equal(process.argv[2], "--live-smoke", "Live smoke requires explicit opt-in");
const base = new URL(process.argv[3]);
assert.equal(base.protocol, "https:");
assert.match(base.hostname, /^[a-z0-9]+\.supabase\.co$/);
assert.equal(base.pathname, "/");
const runId = randomUUID();
const email = `next-smoke-${runId}@example.invalid`;
const label = `NEXT-smoke-${runId}`;
const adminKey = randomBytes(32).toString("hex");
const keyHash = createHash("sha256").update(adminKey).digest("hex");
const device = { fingerprint: randomBytes(32).toString("hex"), label: "Synthetic smoke PC" };
const other = { fingerprint: randomBytes(32).toString("hex"), label: "Synthetic second PC" };
const fixture = { runId, email, label, keyHash, codeIds: [], accountIds: [] };
console.log(JSON.stringify({ setup: fixture }));
const input = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
assert.equal(JSON.parse(await input.question("")).ready, true);
input.close();
let passed = 0;

async function request(name, body, expected, headers = {}) {
  const response = await fetch(new URL(`/functions/v1/${name}`, base), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    expected,
    `${name}/${body.action}: ${response.status} ${data.error ?? "unexpected response"}`,
  );
  passed++;
  return data;
}
const admin = (body, expected = 200) =>
  request("nex-license-admin", body, expected, { "x-nex-admin-key": adminKey });
const session = (body, expected = 200) =>
  request("nex-license-session", { device, ...body }, expected);

try {
  await request("nex-license-admin", { action: "list_codes" }, 400);
  await request("nex-license-admin", { action: "list_codes" }, 403, {
    "x-nex-admin-key": randomBytes(32).toString("hex"),
  });
  const created = await admin({
    action: "create_code",
    planId: "30_days",
    assignedEmail: email,
    note: label,
  });
  assert.ok(created.code?.plain_code);
  fixture.codeIds.push(created.code.code_id);
  console.log(JSON.stringify({ cleanup: fixture }));
  const code = created.code.plain_code;
  const listed = await admin({ action: "list_codes" });
  assert.ok(listed.codes.some((item) => item.id === fixture.codeIds[0]));
  assert.ok(
    listed.codes.every(
      (item) => !Object.hasOwn(item, "code_hash") && !Object.hasOwn(item, "plain_code"),
    ),
  );
  await admin({ action: "list_transfers" });
  await session({ action: "activate", email: "wrong@example.invalid", code }, 403);
  await session({ action: "activate", email, code: "INVALIDSMOKECODE" }, 403);
  const first = await session({ action: "activate", email, code });
  assert.equal(first.access, "allowed");
  assert.ok(/^[a-f0-9]{64}$/.test(first.session.token), "Invalid opaque token format");
  assert.ok(first.authorizationTtlSeconds > 0 && first.authorizationTtlSeconds <= 30);
  fixture.accountIds.push(first.account.id);
  console.log(JSON.stringify({ cleanup: fixture }));
  const verified = await session({ action: "verify", sessionToken: first.session.token });
  assert.equal(verified.access, "allowed");
  assert.ok(!Object.hasOwn(verified.session, "token"));
  await session({ action: "verify", sessionToken: first.session.token, device: other }, 403);
  await session({ action: "activate", email, code, device: other }, 403);
  const retry = await session({ action: "activate", email, code });
  assert.equal(retry.entitlement.expiresAt, first.entitlement.expiresAt);
  await session({ action: "verify", sessionToken: first.session.token }, 403);
  await session({ action: "revoke", sessionToken: retry.session.token });
  await session({ action: "verify", sessionToken: retry.session.token }, 403);
  const restored = await session({ action: "activate", email, code });
  await admin({
    action: "transfer_license",
    accountId: first.account.id,
    originalCode: code,
    newDeviceFingerprint: other.fingerprint,
    newDeviceLabel: other.label,
  });
  await session({ action: "verify", sessionToken: restored.session.token }, 403);
  const transferred = await session({ action: "activate", email, code, device: other });
  assert.equal(transferred.access, "allowed");
  await admin({ action: "revoke_license", accountId: first.account.id });
  await session({ action: "verify", sessionToken: transferred.session.token, device: other }, 403);
  await session({ action: "activate", email, code, device: other }, 403);
  console.log(JSON.stringify({ success: true, passedRequests: passed }));
} catch (error) {
  // Assertion messages above contain only operation/status, never tokens or codes.
  console.error(JSON.stringify({ success: false, passedRequests: passed, error: error.message }));
  process.exitCode = 1;
} finally {
  console.log(JSON.stringify({ cleanup: fixture }));
}
