import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("native licensing and public project configuration target the same NEXT server", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const config = read("src/lib/license-server.ts");
  const url = config.match(/LICENSE_SERVER_URL = "([^"]+)"/)[1];
  const host = read("src-tauri/src/license_transport.rs").match(
    /LICENSE_HOST: &str = "([^"]+)"/,
  )[1];
  assert.equal(new URL(url).hostname, host);
  assert.equal(new URL(url).protocol, "https:");
  assert.ok(read(".env.example").includes(`VITE_SUPABASE_URL=${url}`));
  assert.match(config, /LICENSE_PUBLISHABLE_KEY = "sb_publishable_[^"]+"/);
  assert.ok(!config.includes("sb_secret_"));
});
