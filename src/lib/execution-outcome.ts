import type { ExecutionReport } from "./execution-report";
import type { SystemBootContext } from "./system";

export type PrepareGate = {
  completedAt: string;
  safeMode: boolean;
  hasIssues?: boolean;
  bootIdAtCompletion?: string;
  bootedAtAtCompletion?: string;
};

export function hasExecutionIssues(report: ExecutionReport): boolean {
  const summary = report.summary;
  return (
    summary.plannedActions === 0 ||
    summary.completedActions === 0 ||
    summary.unavailableActions > 0 ||
    summary.failedActions > 0 ||
    summary.cancelledActions > 0 ||
    summary.plannedOnlyActions > 0 ||
    summary.unconfirmedActions > 0 ||
    summary.verificationUnavailableActions > 0
  );
}

export function getPrepareRebootStatus(
  gate: PrepareGate | null,
  bootContext: SystemBootContext | null,
  safeMode: boolean,
): "notPrepared" | "pending" | "confirmed" {
  // Old or partial runs cannot authorize a new execution cycle.
  if (!gate || gate.hasIssues !== false || gate.safeMode !== safeMode) {
    return "notPrepared";
  }
  // A successful simulation can continue without rebooting the user's computer.
  if (safeMode) return "confirmed";
  if (!bootContext?.available || !bootContext.isWindows) return "pending";
  if (gate.bootIdAtCompletion && bootContext.currentBootId) {
    return bootContext.currentBootId !== gate.bootIdAtCompletion ? "confirmed" : "pending";
  }
  if (gate.bootedAtAtCompletion && bootContext.bootedAt) {
    return bootContext.bootedAt !== gate.bootedAtAtCompletion ? "confirmed" : "pending";
  }
  return "pending";
}
