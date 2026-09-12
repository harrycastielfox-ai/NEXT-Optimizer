import {
  AlertTriangle,
  BrainCircuit,
  BrushCleaning,
  CheckCircle2,
  Cpu,
  Gamepad2,
  Gauge,
  Loader2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  runOptimizeAllPhase,
  type OptimizeAllPhaseId,
  type OptimizeAllReports,
} from "@/lib/optimize-all";
import { HERMES_SAFE_TEST_MODE } from "@/lib/safe-mode";
import { RestartPrompt } from "@/components/optimization/RestartPrompt";
import {
  buildExecutionReport,
  type ExecutionReport,
  type ExecutionReportAction,
} from "@/lib/execution-report";
import { verifyExecutionActions } from "@/lib/execution-verification";
import { formatAdvancedActionSummary, type AdvancedActionStatus } from "@/lib/advanced";
import {
  type GamerDependencyDownloadResult,
  type GamerDependencyInstallActionResult,
  type GamerDependencyInstallActionStatus,
  type GamerDependencyInstallResult,
  type GamerDependencyVerificationReport,
} from "@/lib/gamer-dependencies";
import {
  buildOptimizeAuditReportActions,
  OPTIMIZE_AUDIT_ACTION_TARGET,
} from "@/lib/optimize-audit-catalog";
import { publishNexOptimizationState } from "@/lib/nex-companion";
import type { NexOptimizationStatus, NexOptimizationStepStatus } from "@/types/nex-companion";
import { hasExecutionIssues } from "@/lib/execution-outcome";

type RunStatus = "idle" | "running" | "completed" | "failed" | "cancelled";
type PhaseStatus = "pending" | "running" | "completed" | "unavailable" | "failed" | "cancelled";
type PhaseId = OptimizeAllPhaseId;

type OptimizePhase = {
  id: PhaseId;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  plannedActions: number;
  status: PhaseStatus;
  outputs: string[];
};

type LogItem = {
  id: string;
  level: "info" | "warning" | "error";
  message: string;
};

type PlanActionStatus = "ready" | "ok" | "pending" | "unavailable";

type PlanAction = {
  id: string;
  title: string;
  detail: string;
  status: PlanActionStatus;
};

const phaseTemplates: OptimizePhase[] = [
  phase("plan", "Plano inteligente", "Orquestrador + NEXT Insight", BrainCircuit, 14),
  phase("safety", "Permissões e confirmação", "Modo teste, logs e controle", ShieldCheck, 10),
  phase("components", "Componentes essenciais", "VC++, DirectX e dependências", Wrench, 18),
  phase("cleanup", "Limpeza segura", "Temporários, cache e logs", BrushCleaning, 26),
  phase("startup", "Inicialização", "Apps de alto impacto", Zap, 18),
  phase("performance", "Performance", "Energia, Game Mode e rede", Gauge, 22),
  phase(
    "gamer",
    "Pacote gamer global",
    "Game Mode, Fate Trigger, Discord e overlays",
    Gamepad2,
    18,
  ),
  phase("profile", "Consolidação global", "Ajustes internos sem escolha manual", Cpu, 16),
  phase(
    "manual",
    "Avançado guiado",
    "Comandos allowlistados e ajustes finos",
    SlidersHorizontal,
    8,
  ),
];

const TOTAL_PLANNED_ACTIONS = OPTIMIZE_AUDIT_ACTION_TARGET;

export function SmartOptimizeModal({
  open,
  runKey,
  onClose,
  onCompleted,
}: {
  open: boolean;
  runKey: number;
  onClose: () => void;
  onCompleted?: (executionReport: ExecutionReport) => void;
}) {
  const [phases, setPhases] = useState<OptimizePhase[]>(() => resetPhases());
  const [, setLogs] = useState<LogItem[]>([]);
  const [reports, setReports] = useState<OptimizeAllReports>({});
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [currentStatus, setCurrentStatus] = useState("Aguardando otimização.");
  const [finalExecutionReport, setFinalExecutionReport] = useState<ExecutionReport | null>(null);
  const cancelRequested = useRef(false);
  const activeRun = useRef(0);
  const reportActions = useRef<ExecutionReportAction[]>([]);
  const companionRunId = useRef<string | null>(null);
  const companionStartedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    activeRun.current += 1;
    const runId = activeRun.current;
    companionRunId.current = `optimize-${Date.now()}-${runKey}`;
    companionStartedAt.current = Date.now();
    cancelRequested.current = false;
    setPhases(resetPhases());
    setLogs([]);
    setReports({});
    setFinalExecutionReport(null);
    reportActions.current = [];
    setRunStatus("running");
    setCurrentStatus("Preparando plano único do NEXT.");
    void runSmartOptimization(runId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runKey]);

  const processed = useMemo(
    () => phases.filter((item) => item.status !== "pending" && item.status !== "running").length,
    [phases],
  );
  const progress = Math.round((processed / phases.length) * 100);
  const remainingProgress = Math.max(0, 100 - progress);
  const completedActionCount = phases
    .filter((item) => item.status === "completed")
    .reduce((total, item) => total + item.plannedActions, 0);
  const activePhase = phases.find((item) => item.status === "running");
  const hasIssues = finalExecutionReport ? hasExecutionIssues(finalExecutionReport) : false;
  const canCancel = runStatus === "running" && !cancelRequested.current;
  const canClose = runStatus !== "running";
  const planActions = useMemo(() => buildOptimizationPlan(reports), [reports]);
  const readyPlanActions = useMemo(
    () => planActions.filter((item) => item.status === "ready" || item.status === "ok").length,
    [planActions],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const status = runStatus === "completed" && hasIssues ? "error" : mapRunStatus(runStatus);
    const companionSteps = phases.map((item) => ({
      id: item.id,
      title: item.title,
      detail: item.subtitle,
      status: mapPhaseStatus(item.status),
    }));

    void publishNexOptimizationState({
      runId: companionRunId.current,
      phase: "optimize",
      isRunning: status === "running" || status === "paused",
      progress: runStatus === "completed" ? 100 : progress,
      currentStep: currentStatus,
      currentDetail:
        runStatus === "completed"
          ? hasIssues
            ? "Consulte as pendências no relatório."
            : "O plano global foi finalizado."
          : activePhase?.subtitle,
      startedAt: companionStartedAt.current,
      updatedAt: Date.now(),
      completedSteps: companionSteps
        .filter((item) => item.status === "completed")
        .map((item) => item.title),
      pendingSteps: companionSteps
        .filter((item) => item.status === "pending" || item.status === "running")
        .map((item) => item.title),
      steps: companionSteps,
      status,
      errorMessage: runStatus === "failed" || hasIssues ? currentStatus : undefined,
    });
  }, [activePhase?.subtitle, currentStatus, hasIssues, open, phases, progress, runStatus]);

  async function runSmartOptimization(runId: number) {
    try {
      await runPhases(runId, 0, {});
      if (activeRun.current === runId && cancelRequested.current) {
        const partialReport = buildExecutionReport({
          phase: "optimize",
          title: "Otimização cancelada",
          safeMode: HERMES_SAFE_TEST_MODE,
          actions: [
            ...reportActions.current,
            {
              id: "optimize-cancelled",
              title: "Execução cancelada",
              phase: "optimize",
              detail: "Cancelamento não desfaz as ações já executadas.",
              status: "cancelled",
              outputs: [],
              plannedCount: 1,
            },
          ],
          notes: ["Ações anteriores podem ter sido aplicadas. Consulte Segurança e Recuperação."],
        });
        setFinalExecutionReport(partialReport);
        onCompleted?.(partialReport);
        setRunStatus("cancelled");
        setCurrentStatus("Otimização cancelada. O relatório parcial foi preservado.");
      }
    } catch (error) {
      if (activeRun.current !== runId) {
        return;
      }

      setRunStatus("failed");
      setCurrentStatus(
        HERMES_SAFE_TEST_MODE
          ? "Otimização interrompida em modo teste."
          : "Otimização real interrompida.",
      );
      appendLog("error", errorMessage(error));
      const partialReport = buildExecutionReport({
        phase: "optimize",
        title: "Otimização interrompida",
        safeMode: HERMES_SAFE_TEST_MODE,
        actions: [
          ...reportActions.current,
          {
            id: "optimize-interrupted",
            title: "Execução interrompida",
            detail: "Confira os resultados antes de repetir a otimização.",
            phase: "optimize",
            status: "failed",
            outputs: [errorMessage(error)],
            plannedCount: 1,
          },
        ],
        notes: [
          "Algumas ações anteriores podem ter sido aplicadas. Consulte Segurança e Recuperação.",
        ],
      });
      setFinalExecutionReport(partialReport);
      try {
        onCompleted?.(partialReport);
      } catch (saveError) {
        appendLog("error", `Não foi possível salvar o relatório: ${String(saveError)}`);
      }
    }
  }

  async function runPhases(runId: number, startIndex: number, initialReports: OptimizeAllReports) {
    let nextReports: OptimizeAllReports = initialReports;

    for (let index = startIndex; index < phaseTemplates.length; index += 1) {
      const template = phaseTemplates[index];

      if (shouldStop(runId)) return;

      await executePhase(runId, template.id, async () => {
        const result = await runOptimizeAllPhase(template.id);

        nextReports = { ...nextReports, ...result.reports };
        setReports({ ...nextReports });

        return result.outputs;
      });

      if (shouldStop(runId)) {
        return;
      }
    }

    if (activeRun.current !== runId) {
      return;
    }

    setCurrentStatus("Confirmando ajustes no Windows.");
    const advancedDetailedActions = mergeAdvancedExecutionDetails(
      reportActions.current,
      nextReports,
      HERMES_SAFE_TEST_MODE,
    );
    const verifiedActions = await verifyExecutionActions(
      advancedDetailedActions,
      HERMES_SAFE_TEST_MODE,
    );
    const detailedActions = mergeGamerDependencyExecutionDetails(
      verifiedActions,
      nextReports,
      HERMES_SAFE_TEST_MODE,
    );
    reportActions.current = detailedActions;

    if (shouldStop(runId)) {
      return;
    }

    setRunStatus("completed");
    setCurrentStatus(
      HERMES_SAFE_TEST_MODE
        ? "Plano único concluído. Modo teste mantido."
        : "Plano único concluído. Execução real finalizada.",
    );
    appendLog(
      "info",
      HERMES_SAFE_TEST_MODE
        ? "Otimizar Tudo finalizado em modo teste."
        : "Otimizar Tudo finalizado em modo real.",
    );
    const executionReport = buildExecutionReport({
      phase: "optimize",
      title: "Otimização Avançada",
      safeMode: HERMES_SAFE_TEST_MODE,
      actions: detailedActions,
      notes: [
        "Botão 2 concluído em fluxo guiado.",
        `O catálogo atual possui ${OPTIMIZE_AUDIT_ACTION_TARGET} ações auditáveis por fases do plano NEXT.`,
        ...gamerDependencyReportNotes(nextReports),
        HERMES_SAFE_TEST_MODE
          ? "Modo teste: nenhuma alteração real foi aplicada."
          : "Modo real: fases implementadas foram executadas.",
      ],
    });
    setFinalExecutionReport(executionReport);
    if (hasExecutionIssues(executionReport)) {
      setCurrentStatus("Otimização com pendências. Consulte o relatório.");
    }
    onCompleted?.(executionReport);
  }

  async function executePhase(
    runId: number,
    phaseId: PhaseId,
    task: () => Promise<string[]> | string[],
  ) {
    if (shouldStop(runId)) {
      return;
    }

    const template = phaseTemplates.find((item) => item.id === phaseId);
    setCurrentStatus(template?.title ?? "Executando fase.");
    updatePhase(phaseId, { status: "running", outputs: ["Executando validação local."] });
    appendLog("info", `Iniciando: ${template?.title ?? phaseId}.`);

    try {
      const outputs = await task();
      if (activeRun.current !== runId) {
        return;
      }

      updatePhase(phaseId, { status: "completed", outputs });
      upsertReportAction(phaseId, "completed", outputs);
      appendLog("info", `${template?.title ?? phaseId}: concluído.`);
    } catch (error) {
      const message = errorMessage(error);
      updatePhase(phaseId, {
        status: "unavailable",
        outputs: [message, "A fase não concluiu. Ações anteriores podem ter sido aplicadas."],
      });
      upsertReportAction(phaseId, "unavailable", [
        message,
        "A fase não concluiu. Consulte Segurança e Recuperação.",
      ]);
      appendLog("warning", `${template?.title ?? phaseId}: ${message}`);
      if (!HERMES_SAFE_TEST_MODE) {
        throw new Error(`${template?.title ?? phaseId}: ${message}`);
      }
    }
  }

  function upsertReportAction(
    phaseId: PhaseId,
    status: "completed" | "unavailable",
    outputs: string[],
  ) {
    const actions = buildOptimizeAuditReportActions({
      phaseId,
      phaseStatus: status,
      safeMode: HERMES_SAFE_TEST_MODE,
      outputs,
    });

    if (actions.length === 0) {
      return;
    }

    const actionIds = new Set(actions.map((action) => action.id));
    reportActions.current = [
      ...reportActions.current.filter((item) => !actionIds.has(item.id)),
      ...actions,
    ];
  }

  function requestCancel() {
    cancelRequested.current = true;
    setCurrentStatus("Cancelamento solicitado. Aguardando a ação atual terminar.");
    setPhases((current) =>
      current.map((item) =>
        item.status === "pending"
          ? { ...item, status: "cancelled", outputs: ["Cancelado pelo usuário."] }
          : item,
      ),
    );
    appendLog("warning", "Usuário cancelou o fluxo Otimizar Tudo.");
  }

  function shouldStop(runId: number) {
    if (activeRun.current !== runId) {
      return true;
    }

    if (!cancelRequested.current) {
      return false;
    }

    return true;
  }

  function updatePhase(phaseId: PhaseId, patch: Partial<OptimizePhase>) {
    setPhases((current) =>
      current.map((item) => (item.id === phaseId ? { ...item, ...patch } : item)),
    );
  }

  function appendLog(level: LogItem["level"], message: string) {
    const id = crypto.randomUUID();
    setLogs((current) => [{ id, level, message }, ...current].slice(0, 8));
  }

  if (!open) {
    return null;
  }

  return (
    <div
      data-testid="hermes-optimize-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-3 py-4 backdrop-blur-sm"
    >
      <div className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-border/80 bg-card/95 text-card-foreground shadow-[0_30px_90px_-40px_rgba(15,23,42,0.55)] backdrop-blur-xl">
        <header className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_16px_34px_-22px_rgba(37,99,235,0.9)]">
              <Sparkles className="h-8 w-8" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold tracking-[0.22em] text-primary">MODO SIMPLES</p>
              <h2 className="mt-1 text-2xl font-black leading-tight text-foreground">
                Otimizar Tudo
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {activePhase?.title ?? currentStatus}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={!canClose}
            aria-label="Fechar Otimizar Tudo"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background/80 text-muted-foreground transition hover:bg-muted disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 lg:px-6">
          <section className="mx-auto flex max-w-3xl flex-col items-center py-4 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/12 text-primary">
              {runStatus === "completed" && !hasIssues ? (
                <CheckCircle2 className="h-7 w-7" />
              ) : runStatus === "failed" || runStatus === "cancelled" || hasIssues ? (
                <AlertTriangle className="h-7 w-7" />
              ) : (
                <Loader2 className="h-7 w-7 animate-spin" />
              )}
            </span>
            <p className="mt-4 text-[11px] font-black uppercase tracking-[0.2em] text-primary">
              {HERMES_SAFE_TEST_MODE ? "Validação segura" : "Otimização global"}
            </p>
            <h3 className="mt-2 text-xl font-black text-foreground">{currentStatus}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {runStatus === "completed"
                ? hasIssues
                  ? "Há ações que exigem revisão."
                  : "O processo foi concluído."
                : `${activePhase?.title ?? "Finalizando"} · ${progress}% concluído`}
            </p>
            <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-3 flex items-center gap-3 text-xs font-bold text-muted-foreground">
              <span>{progress}%</span>
              <span aria-hidden="true">•</span>
              <span>{HERMES_SAFE_TEST_MODE ? "Modo teste" : "Modo real"}</span>
            </div>
          </section>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-bold text-primary">
              Ver etapas, resultados e relatório
            </summary>
            <section className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
              <SummaryCard
                icon={Zap}
                label="Ações avaliadas"
                value={`${TOTAL_PLANNED_ACTIONS}`}
                sub={`Agrupadas em ${phaseTemplates.length} fases`}
              />
              <SummaryCard
                icon={CheckCircle2}
                label="Processadas"
                value={`${completedActionCount}`}
                sub={`${progress}% do fluxo`}
              />
              <SummaryCard
                icon={Cpu}
                label="Plano"
                value="Global"
                sub="Sem perfil ou jogo manual nesta fase"
              />
              <SummaryCard
                icon={ShieldCheck}
                label="Modo"
                value={HERMES_SAFE_TEST_MODE ? "Teste" : "Real"}
                sub={HERMES_SAFE_TEST_MODE ? "Modo teste ativo" : "Execução real liberada"}
              />
            </section>

            <div className="mb-4 rounded-2xl border border-warning/25 bg-warning/10 px-4 py-3 text-warning">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-sm font-bold">
                    Plano NEXT validado antes de qualquer mudança real.
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed">
                    {HERMES_SAFE_TEST_MODE
                      ? "Modo teste ativo: o NEXT confere o caminho completo sem alterar o Windows."
                      : "Modo real ligado: o NEXT executa somente ajustes liberados e confirmados pelo motor."}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5">
              <div className="space-y-3">
                <div className="rounded-2xl border border-border/70 bg-background/72 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-foreground">{currentStatus}</h3>
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        Fase atual: {activePhase?.title ?? "Finalizando"}.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-right">
                      <ProgressStat label="Concluído" value={`${progress}%`} />
                      <ProgressStat label="Falta" value={`${remainingProgress}%`} />
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {phases.map((item) => (
                    <PhaseCard key={item.id} phase={item} />
                  ))}
                </div>

                {reports.gamerDependencyVerification && (
                  <GamerDependenciesPanel
                    report={reports.gamerDependencyVerification}
                    automaticDownloadResult={reports.gamerDependencyDownloadResult}
                    automaticInstallResult={reports.gamerDependencyInstallResult}
                  />
                )}

                {finalExecutionReport && <OptimizationSuccessPanel report={finalExecutionReport} />}
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-2xl border border-border/70 bg-background/72 p-3 text-center">
                <ProgressStat label="Motor" value="NEXT" />
                <ProgressStat label="Validadas" value={`${readyPlanActions}`} />
                <ProgressStat label="Modo" value={HERMES_SAFE_TEST_MODE ? "Teste" : "Real"} />
              </div>
            </div>
          </details>
        </div>

        {runStatus === "completed" && !hasIssues && !HERMES_SAFE_TEST_MODE && (
          <div className="border-t border-border/70 bg-background/78 px-5 py-4 lg:px-6">
            <RestartPrompt phase="optimize" />
          </div>
        )}

        <footer className="flex flex-col gap-3 border-t border-border/70 bg-background/78 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-success" />
            {HERMES_SAFE_TEST_MODE
              ? "Modo de teste: nenhuma alteração real será aplicada."
              : "Modo real: executa funções implementadas com confirmação."}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {canCancel && (
              <button
                type="button"
                onClick={requestCancel}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground transition hover:bg-muted"
              >
                Cancelar
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={!canClose}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_12px_28px_-18px_rgba(37,99,235,0.9)] transition hover:bg-primary/95 disabled:opacity-50"
            >
              {runStatus === "running" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {runStatus === "running" ? "Executando" : "Concluir"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function mapRunStatus(status: RunStatus): NexOptimizationStatus {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "error";
    case "cancelled":
      return "cancelled";
    default:
      return "idle";
  }
}

function mapPhaseStatus(status: PhaseStatus): NexOptimizationStepStatus {
  switch (status) {
    case "running":
      return "running";
    case "completed":
    case "unavailable":
      return "completed";
    case "failed":
      return "error";
    default:
      return "pending";
  }
}

function buildOptimizationPlan(reports: OptimizeAllReports): PlanAction[] {
  const actions: PlanAction[] = [];

  if (reports.diagnostic) {
    actions.push({
      id: "diagnostic",
      title: "Diagnóstico do PC",
      detail: `Saúde ${Math.round(reports.diagnostic.healthScore)}/100 analisada.`,
      status: "ok",
    });
  } else {
    actions.push({
      id: "diagnostic",
      title: "Diagnóstico do PC",
      detail: "Aguardando coleta inicial.",
      status: "pending",
    });
  }

  if (reports.clean) {
    let detail = "Sem volume relevante encontrado.";
    if (reports.cleanResult) {
      detail = `${reports.cleanResult.plannedEntries} item(ns) ${appliedVerb(reports.cleanResult.dryRun)} pela engine.`;
    } else if (reports.clean.totalGb > 0) {
      detail = `${formatGb(reports.clean.totalGb)} GB encontrados para revisar.`;
    }

    actions.push({
      id: "cleanup",
      title: "Limpeza segura",
      detail,
      status: reports.cleanResult || reports.clean.totalGb > 0 ? "ready" : "ok",
    });
  }

  if (reports.startup) {
    let detail = `${reports.startup.totalItems} item(ns) monitorados.`;
    if (reports.startupResult) {
      detail = `${reports.startupResult.selectedItems} item(ns) ${appliedVerb(reports.startupResult.dryRun)} pela engine.`;
    } else if (reports.startup.highImpactCount > 0) {
      detail = `${reports.startup.highImpactCount} item(ns) de alto impacto.`;
    }

    actions.push({
      id: "startup",
      title: "Inicialização",
      detail,
      status: reports.startupResult || reports.startup.highImpactCount > 0 ? "ready" : "ok",
    });
  }

  if (reports.performance) {
    actions.push({
      id: "performance",
      title: "Performance",
      detail: reports.performanceResult
        ? `${reports.performanceResult.appliedActions.length} ajuste(s) ${appliedVerb(reports.performanceResult.dryRun)} pela engine.`
        : `Plano atual: ${reports.performance.powerPlan.activeSchemeName}.`,
      status: "ready",
    });
  }

  if (reports.gamer) {
    let detail = "Pacote gamer global mapeado.";
    if (reports.gamerResult) {
      detail = `${reports.gamerResult.closedProcesses.length} processo(s) ${reports.gamerResult.dryRun ? "validados" : "fechados"} pela engine.`;
    } else if (reports.gamer.summary.detectedGames > 0) {
      detail = `${reports.gamer.summary.detectedGames} jogo(s) detectado(s).`;
    }

    actions.push({
      id: "gamer",
      title: "Pacote gamer global",
      detail,
      status: reports.gamerResult || reports.gamer.summary.detectedGames > 0 ? "ready" : "ok",
    });
  }

  if (reports.gamerFocusAdvanced || reports.gamerFocusAdvancedResult) {
    actions.push({
      id: "gamer-focus",
      title: "Fate Trigger / UE5",
      detail: reports.gamerFocusAdvancedResult
        ? `${formatAdvancedActionSummary(reports.gamerFocusAdvancedResult)} no pacote MMCSS/CPU.`
        : "Pacote MMCSS Gamer + prioridade Fate Trigger mapeado.",
      status: reports.gamerFocusAdvancedResult ? "ready" : "pending",
    });
  }

  actions.push({
    id: "profile",
    title: "Plano global NEXT",
    detail: "Consolidação interna sem perfil favorito e sem escolha manual.",
    status: "ready",
  });

  if (reports.advanced) {
    actions.push({
      id: "advanced",
      title: "Avançado guiado",
      detail: reports.advancedResult
        ? `${formatAdvancedActionSummary(reports.advancedResult)} pela Advanced Engine.`
        : `${reports.advanced.actions.length} comando(s) mapeados.`,
      status: reports.advancedResult ? "ready" : "pending",
    });
  }

  const componentCmds = reports.advanced?.actions.filter((action) => action.id.startsWith("dism-"));
  actions.push({
    id: "components",
    title: "Componentes CMD/DISM",
    detail: componentCmds?.length
      ? `${componentCmds.length} comando(s): limpeza de componentes, NetFx3 e DirectPlay.`
      : "Aguardando mapeamento de componentes do Windows.",
    status: componentCmds?.length ? "ready" : "pending",
  });

  if (reports.gamerDependencies) {
    const verification = reports.gamerDependencyVerification;
    actions.push({
      id: "gamer-dependencies",
      title: "VC++/DirectX",
      detail: verification
        ? `${verification.readyCount}/${verification.totalPackages} pacote(s) prontos; ${verification.installedLocallyCount} já instalado(s), ${verification.blockedCount} bloqueado(s).`
        : `${reports.gamerDependencies.totalPackages} pacote(s) mapeados; instalação bloqueada por hash/assinatura.`,
      status: reports.gamerDependencies.readyCount > 0 ? "ready" : "unavailable",
    });
    actions.push({
      id: "developer-toolchain-policy",
      title: "Toolchain pesada fora",
      detail: `${reports.gamerDependencies.excludedToolchain.length} item(ns) observados do Peninha ficam fora: Build Tools, Visual Studio Installer, Windows SDK e App Runtime.`,
      status: "ready",
    });
  }

  return actions;
}

function ProgressStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-1.5">
      <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-primary">
        {label}
      </span>
      <span className="block text-sm font-black text-foreground">{value}</span>
    </span>
  );
}

function OptimizationSuccessPanel({ report }: { report: ExecutionReport }) {
  const hasIssues = hasExecutionIssues(report);
  return (
    <section
      data-testid="hermes-optimize-success"
      className="overflow-hidden rounded-2xl border border-success/25 bg-success/10"
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-success text-success-foreground shadow-[0_18px_34px_-24px_rgba(34,197,94,0.9)]">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-success">
              {hasIssues ? "Pendências" : report.safeMode ? "Simulação" : "Resultado"}
            </p>
            <h3 className="mt-1 text-xl font-black text-foreground">
              {hasIssues ? "Otimização incompleta" : "Otimização concluída"}
            </h3>
            <p className="mt-1 text-sm font-medium text-muted-foreground">
              {hasIssues
                ? "Consulte os resultados. Algumas ações falharam ou não foram confirmadas."
                : report.safeMode
                  ? "Simulação concluída. A execução real ainda exige validação em ambiente de testes."
                  : "Os ajustes foram executados e verificados. Reinicie quando estiver pronto."}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-right">
          <span className="rounded-xl border border-success/20 bg-background/70 px-3 py-2">
            <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-success">
              Plano
            </span>
            <span className="block text-sm font-black text-foreground">
              {report.summary.completedActions}/{report.summary.plannedActions} ações
            </span>
          </span>
          <span className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2">
            <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-primary">
              Modo
            </span>
            <span className="block text-sm font-black text-foreground">
              {report.safeMode ? "Teste" : "Real"}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}

function GamerDependenciesPanel({
  report,
  automaticDownloadResult,
  automaticInstallResult,
}: {
  report: GamerDependencyVerificationReport;
  automaticDownloadResult?: GamerDependencyDownloadResult;
  automaticInstallResult?: GamerDependencyInstallResult;
}) {
  const warning = automaticInstallResult?.message ?? report.warnings[0];
  const downloadedCount = automaticDownloadResult?.downloadedCount ?? 0;
  const installedOrSimulatedCount = automaticInstallResult
    ? automaticInstallResult.installedCount + countInstallStatus(automaticInstallResult, "dryRun")
    : 0;

  return (
    <section className="rounded-2xl border border-border/70 bg-background/72 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-[0.18em] text-primary">VC++ / DIRECTX</p>
            <h3 className="mt-1 text-base font-black text-foreground">
              Dependências gamer automáticas
            </h3>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Baixa, valida e instala apenas runtimes oficiais quando o Botão 2 roda em modo real.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-4">
          <DependencyStat label="Prontas" value={report.readyCount} tone="success" />
          <DependencyStat label="Baixadas" value={downloadedCount} tone="primary" />
          <DependencyStat label="Aplicadas" value={installedOrSimulatedCount} tone="success" />
          <DependencyStat label="Pendentes" value={report.blockedCount} tone="warning" />
        </div>
      </div>

      {warning && (
        <p className="mt-3 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-[11px] font-semibold text-warning">
          {warning}
        </p>
      )}
    </section>
  );
}
function DependencyStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "primary" | "success" | "warning";
}) {
  const className =
    tone === "success"
      ? "border-success/20 bg-success/10 text-success"
      : tone === "warning"
        ? "border-warning/25 bg-warning/10 text-warning"
        : "border-primary/20 bg-primary/10 text-primary";

  return (
    <span className={`rounded-xl border px-3 py-1.5 ${className}`}>
      <span className="block text-[9px] font-bold uppercase tracking-[0.12em]">{label}</span>
      <span className="block text-sm font-black">{value}</span>
    </span>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/72 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.14em] text-muted-foreground">{label}</p>
          <p className="truncate text-base font-bold text-foreground">{value}</p>
          <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
        </div>
      </div>
    </div>
  );
}

function PhaseCard({ phase }: { phase: OptimizePhase }) {
  const Icon =
    phase.status === "running" ? Loader2 : phase.status === "completed" ? CheckCircle2 : phase.icon;

  return (
    <article className="rounded-2xl border border-border/70 bg-background/72 p-4">
      <div className="flex items-start gap-3">
        <span
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${phaseIconClass(phase.status)}`}
        >
          <Icon className={`h-5 w-5 ${phase.status === "running" ? "animate-spin" : ""}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-foreground">{phase.title}</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">{phase.subtitle}</p>
            </div>
            <span
              className={`rounded-full border px-2 py-1 text-[10px] font-bold ${phasePillClass(phase.status)}`}
            >
              {phaseStatusLabel(phase.status)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
              {phase.plannedActions} ações
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              Engine real
            </span>
          </div>
          {phase.outputs.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {phase.outputs.slice(0, 3).map((output, index) => (
                <p
                  key={`${phase.id}-${index}`}
                  className="rounded-lg border border-border/60 bg-muted/45 px-2.5 py-1.5 text-[11px] font-medium text-foreground"
                >
                  {output}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function phase(
  id: PhaseId,
  title: string,
  subtitle: string,
  icon: LucideIcon,
  plannedActions: number,
): OptimizePhase {
  return {
    id,
    title,
    subtitle,
    icon,
    plannedActions,
    status: "pending",
    outputs: [],
  };
}

function resetPhases() {
  return phaseTemplates.map((item) => ({
    ...item,
    status: "pending" as const,
    outputs: [],
  }));
}

function phaseIconClass(status: PhaseStatus) {
  if (status === "completed") return "bg-success/10 text-success";
  if (status === "running") return "bg-primary/10 text-primary";
  if (status === "unavailable") return "bg-warning/10 text-warning";
  if (status === "failed") return "bg-destructive/10 text-destructive";
  if (status === "cancelled") return "bg-muted text-muted-foreground";
  return "bg-primary-soft text-primary";
}

function phasePillClass(status: PhaseStatus) {
  if (status === "completed") return "border-success/20 bg-success/10 text-success";
  if (status === "running") return "border-primary/20 bg-primary/10 text-primary";
  if (status === "unavailable") return "border-warning/25 bg-warning/10 text-warning";
  if (status === "failed") return "border-destructive/20 bg-destructive/10 text-destructive";
  if (status === "cancelled") return "border-border bg-muted text-muted-foreground";
  return "border-border bg-muted text-muted-foreground";
}

function phaseStatusLabel(status: PhaseStatus) {
  if (status === "completed") return "Ok";
  if (status === "running") return "Rodando";
  if (status === "unavailable") return "Indisp.";
  if (status === "failed") return "Falha";
  if (status === "cancelled") return "Cancelado";
  return "Pendente";
}

function mergeAdvancedExecutionDetails(
  actions: ExecutionReportAction[],
  reports: OptimizeAllReports,
  safeMode: boolean,
) {
  const advancedResult = reports.advancedResult;
  if (!advancedResult) {
    return actions;
  }

  const advancedActions = new Map(
    advancedResult.appliedActions.map((action) => [action.id, action] as const),
  );

  return actions.map((action) => {
    const advancedActionId = advancedActionIdFromReportAction(action);
    const advancedAction = advancedActionId ? advancedActions.get(advancedActionId) : undefined;
    if (!advancedAction) {
      return action;
    }

    return {
      ...action,
      status: advancedReportStatus(advancedAction.status),
      outputs: advancedReportOutputs(advancedAction, safeMode),
      implemented: true,
    };
  });
}

function advancedActionIdFromReportAction(action: ExecutionReportAction) {
  const command = action.commandPreview ?? "";
  const commandMatch = command.match(/^advanced\.([a-z0-9-]+)$/i);
  if (commandMatch) {
    return commandMatch[1];
  }

  const technicalNameMap: Record<string, string> = {
    "Power.Hibernate": "disable-hibernation",
    "Explorer.StartupDelay": "disable-startup-delay",
    "Boot.Timeout": "set-boot-timeout-fast",
    "Service.DiagTrack.Start": "set-diagtrack-service-manual",
    "Service.MapsBroker.Start": "set-mapsbroker-service-manual",
    "Service.WerSvc.Start": "set-wersvc-service-manual",
    "Service.WMPNetworkSvc.Start": "set-wmpnetworksvc-service-manual",
    "Service.Fax.Start": "set-fax-service-manual",
    "Service.RetailDemo.Start": "set-retaildemo-service-manual",
    "Service.PhoneSvc.Start": "set-phonesvc-service-manual",
    "Service.WalletService.Start": "set-walletservice-manual",
    "Service.XblAuthManager.Start": "set-xbl-auth-manager-manual",
    "Service.XblGameSave.Start": "set-xbl-game-save-manual",
    "Service.XboxNetApiSvc.Start": "set-xbox-net-api-svc-manual",
  };

  return action.technicalName ? technicalNameMap[action.technicalName] : undefined;
}

function advancedReportStatus(status: AdvancedActionStatus): ExecutionReportAction["status"] {
  if (status === "dryRun") return "simulated";
  if (status === "applied") return "applied";
  if (status === "skipped") return "unavailable";
  return "failed";
}

function advancedReportOutputs(
  action: { title: string; status: AdvancedActionStatus; message: string },
  safeMode: boolean,
) {
  const statusLabel =
    action.status === "dryRun"
      ? "Simulado"
      : action.status === "applied"
        ? "Aplicado"
        : action.status === "skipped"
          ? "Indisponível neste Windows"
          : "Falha";

  return [
    `${statusLabel}: ${action.title}`,
    action.message,
    safeMode
      ? "Modo teste: nenhuma alteração real foi aplicada."
      : "Modo real: retorno confirmado pela Advanced Engine.",
  ];
}

function mergeGamerDependencyExecutionDetails(
  actions: ExecutionReportAction[],
  reports: OptimizeAllReports,
  safeMode: boolean,
) {
  const installResult = reports.gamerDependencyInstallResult;
  if (!installResult) {
    return actions;
  }

  const checkedAt = new Date().toISOString();
  const installActions = new Map(
    installResult.actions.map((action) => [action.packageId, action] as const),
  );

  return actions.map((action) => {
    const packageId = dependencyPackageIdFromReportAction(action.id);
    const installAction = packageId ? installActions.get(packageId) : undefined;
    if (!installAction) {
      return action;
    }

    const status = dependencyInstallReportStatus(installAction.status);

    return {
      ...action,
      status,
      outputs: dependencyReportOutputs(installAction, reports.gamerDependencyDownloadResult),
      commandPreview: installAction.commandPreview,
      method: "cmd",
      implemented: true,
      verification: dependencyInstallVerification(installAction, status, safeMode, checkedAt),
    };
  });
}

function dependencyPackageIdFromReportAction(actionId: string) {
  const slug = actionId.split(".").at(-1) ?? actionId;
  if (slug === "directx-runtime") {
    return "directx-end-user-runtime";
  }
  if (slug.startsWith("vc-redist-")) {
    return slug;
  }
  return null;
}

function dependencyInstallReportStatus(
  status: GamerDependencyInstallActionStatus,
): ExecutionReportAction["status"] {
  if (status === "dryRun") return "simulated";
  if (status === "installed") return "applied";
  if (status === "skipped") return "scanned";
  if (status === "failed") return "failed";
  return "unavailable";
}

function dependencyReportOutputs(
  action: GamerDependencyInstallActionResult,
  downloadResult?: GamerDependencyDownloadResult,
) {
  const cacheLine = downloadResult
    ? `Cache oficial: ${downloadResult.downloadedCount} baixado(s), ${downloadResult.skippedCount} pulado(s), ${downloadResult.failedCount} falha(s).`
    : "Cache oficial: verificação local executada.";

  return [
    cacheLine,
    `${dependencyInstallStatusLabel(action.status)}: ${action.message}`,
    `Comando: ${action.commandPreview}`,
    `Instalador: ${action.installerFileName}`,
  ];
}

function dependencyInstallVerification(
  action: GamerDependencyInstallActionResult,
  status: ExecutionReportAction["status"],
  safeMode: boolean,
  checkedAt: string,
): ExecutionReportAction["verification"] {
  if (action.status === "installed") {
    return {
      status: "confirmed",
      detail: "Instalador verificado por SHA256/assinatura e executado pelo motor NEXT.",
      checkedAt,
    };
  }

  if (action.status === "skipped") {
    return {
      status: "confirmed",
      detail: "Dependência já detectada no Windows; o NEXT não reinstalou.",
      checkedAt,
    };
  }

  if (action.status === "failed") {
    return {
      status: "notConfirmed",
      detail: action.message,
      checkedAt,
    };
  }

  if (status === "unavailable") {
    return {
      status: "unavailable",
      detail: action.message,
      checkedAt,
    };
  }

  return {
    status: "notRequired",
    detail: safeMode
      ? "Modo teste: instalador verificado, mas não executado."
      : "Ação sem confirmação posterior obrigatória.",
    checkedAt,
  };
}

function gamerDependencyReportNotes(reports: OptimizeAllReports) {
  const installResult = reports.gamerDependencyInstallResult;
  if (!installResult) {
    return [];
  }

  return [
    `Dependências gamer: ${installResult.actions.length} pacote(s) VC++/DirectX avaliados no Botão 2.`,
    installResult.dryRun
      ? "Dependências gamer ficaram em modo teste; nenhum instalador foi executado."
      : `${installResult.installedCount} instalado(s), ${installResult.skippedCount} pulado(s), ${installResult.blockedCount} bloqueado(s).`,
  ];
}

function countInstallStatus(
  result: GamerDependencyInstallResult,
  status: GamerDependencyInstallActionStatus,
) {
  return result.actions.filter((item) => item.status === status).length;
}

function dependencyInstallStatusLabel(status: GamerDependencyInstallActionStatus) {
  if (status === "installed") return "Instalado";
  if (status === "dryRun") return "Simulado";
  if (status === "skipped") return "Pulado";
  if (status === "failed") return "Falha";
  return "Bloqueado";
}

function appliedVerb(dryRun: boolean) {
  return dryRun ? "validados" : "aplicados";
}

function formatGb(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
