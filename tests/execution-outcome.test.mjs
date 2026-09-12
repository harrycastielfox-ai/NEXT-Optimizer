import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Load only pure functions. No browser, Tauri IPC or Windows commands are involved.
async function loadPureModule(file) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const { hasExecutionIssues, getPrepareRebootStatus } = await loadPureModule(
  "../src/lib/execution-outcome.ts",
);
const { buildExecutionReport } = await loadPureModule("../src/lib/execution-report.ts");

function report(status, verification = "notRequired") {
  return buildExecutionReport({
    phase: "prepare",
    title: "Test",
    safeMode: status === "simulated",
    notes: [],
    actions: [
      {
        id: "action",
        title: "Action",
        detail: "",
        phase: "prepare",
        status,
        outputs: [],
        plannedCount: 1,
        verification: { status: verification, detail: "", checkedAt: "2026-09-12" },
      },
    ],
  });
}

test("failed, unavailable, cancelled and planned actions cannot claim success", () => {
  for (const status of ["failed", "unavailable", "cancelled", "planned"]) {
    assert.equal(hasExecutionIssues(report(status)), true, status);
  }
});
test("empty execution is incomplete", () => {
  assert.equal(
    hasExecutionIssues(
      buildExecutionReport({ phase: "prepare", title: "", safeMode: true, actions: [], notes: [] }),
    ),
    true,
  );
});
test("unconfirmed writes are not a successful preparation", () => {
  assert.equal(hasExecutionIssues(report("applied", "notConfirmed")), true);
  assert.equal(hasExecutionIssues(report("applied", "unavailable")), true);
  assert.equal(hasExecutionIssues(report("applied", "confirmed")), false);
  assert.equal(hasExecutionIssues(report("simulated")), false);
});

const gate = {
  completedAt: "2026-09-12",
  safeMode: false,
  hasIssues: false,
  bootIdAtCompletion: "boot-1",
};
const boot = { available: true, isWindows: true, currentBootId: "boot-2", warnings: [] };
test("legacy, incomplete and test-mode gates do not unlock real execution", () => {
  for (const value of [
    null,
    { ...gate, hasIssues: true },
    { ...gate, hasIssues: undefined },
    { ...gate, safeMode: true },
  ]) {
    assert.equal(getPrepareRebootStatus(value, boot, false), "notPrepared");
  }
});
test("unavailable or missing boot identity never counts as a reboot", () => {
  for (const value of [
    null,
    { ...boot, available: false },
    { ...boot, currentBootId: undefined },
    { ...boot, isWindows: false },
  ]) {
    assert.equal(getPrepareRebootStatus(gate, value, false), "pending");
  }
});
test("real execution requires an actual boot identity change", () => {
  assert.equal(
    getPrepareRebootStatus(gate, { ...boot, currentBootId: "boot-1" }, false),
    "pending",
  );
  assert.equal(getPrepareRebootStatus(gate, boot, false), "confirmed");
});
test("successful simulation continues without restarting Windows", () => {
  assert.equal(getPrepareRebootStatus({ ...gate, safeMode: true }, null, true), "confirmed");
  assert.equal(
    getPrepareRebootStatus({ ...gate, safeMode: true, hasIssues: true }, null, true),
    "notPrepared",
  );
});
