import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

// Source contract tests: these intentionally do NOT execute packaging/install/GUI scripts.
test("automated QA cannot call the manual quick-pass path", () => {
  const auto = read("scripts/run-manual-qa-test-drop-auto.ps1");
  assert.ok(auto.includes('"-InitializeOnly"'));
  assert.ok(!auto.includes('"-QuickPassAll"'));
  const runner = read("scripts/create-manual-qa-test-drop.ps1");
  assert.ok(runner.includes("if (`$InitializeOnly -or `$autoSafeMode)"));
});

test("evidence initialization is pending-only and does not overwrite existing evidence", () => {
  const portable = read("scripts/create-manual-qa-portable.ps1");
  const initializer = portable.split("if ($InitializeOnly) {")[1]?.split("if ($QuickPassAll) {")[0];
  assert.ok(initializer);
  assert.ok(initializer.includes('-Status "pending"'));
  assert.ok(!initializer.includes('-Status "passed"'));
  assert.ok(initializer.includes("Test-Path -LiteralPath $evidencePath -PathType Leaf"));
  assert.ok(portable.includes('$confirmation -cne "VALIDADO"'));
  assert.ok(portable.includes('$env:CI -eq "true"'));
});

test("a failed native build cannot be reported as a successful installer", () => {
  const script = read("scripts/build-windows-controlled.ps1");
  assert.ok(script.includes("$buildExitCode = $LASTEXITCODE"));
  assert.ok(script.includes("if ($buildExitCode -ne 0)"));
  assert.ok(script.includes('throw "Build Tauri falhou'));
});
