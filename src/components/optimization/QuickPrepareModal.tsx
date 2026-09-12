import {
  AlertTriangle,
  CheckCircle2,
  Gauge,
  HardDrive,
  Loader2,
  MonitorCog,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  buildQuickPrepareTaskPlan,
  getDnsProvider,
  runQuickPrepareExecutor,
  type DnsProviderId,
  type QuickPreparePhaseId,
  type QuickPrepareReports,
  type QuickPrepareTaskUpdate,
} from "@/lib/quick-prepare";
import { HERMES_SAFE_TEST_MODE } from "@/lib/safe-mode";
import type { DiagnosticReport } from "@/lib/diagnostic";
import { RestartPrompt } from "@/components/optimization/RestartPrompt";
import { type GamerDependencyVerificationReport } from "@/lib/gamer-dependencies";
import {
  buildExecutionReport,
  type ExecutionReport,
  type ExecutionReportAction,
  type ExecutionReportStatus,
} from "@/lib/execution-report";
import { verifyExecutionActions } from "@/lib/execution-verification";
import { publishNexOptimizationState } from "@/lib/nex-companion";
import type { NexOptimizationStatus, NexOptimizationStepStatus } from "@/types/nex-companion";
import { hasExecutionIssues } from "@/lib/execution-outcome";

type RunStatus = "idle" | "running" | "completed" | "failed" | "cancelled";
type PhaseStatus = "pending" | "running" | "completed" | "unavailable" | "cancelled";

type PreparePhase = {
  id: QuickPreparePhaseId;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  status: PhaseStatus;
  outputs: string[];
};

type LogItem = {
  id: string;
  level: "info" | "warning" | "error";
  message: string;
};

const phaseTemplates: PreparePhase[] = [
  phase("scan", "Mapear máquina", "Leitura local do estado atual", MonitorCog),
  phase("components", "Dependências gamer", "VC++, DirectX, hash e assinatura", ShieldCheck),
  phase("cleanup", "Limpar temporários", "Cache, logs e arquivos seguros", HardDrive),
  phase("startup", "Reduzir inicialização", "Apps de alto impacto", Zap),
  phase("windows", "Ajustar Windows", "Game Mode, GameDVR e visual mínimo", Gauge),
  phase("processes", "Liberar processos", "Fecha segundo plano com proteções", Sparkles),
];

export function QuickPrepareModal({
  open,
  runKey,
  onClose,
  onDiagnostic,
  onCompleted,
  dnsProviderId,
}: {
  open: boolean;
  runKey: number;
  onClose: () => void;
  onDiagnostic?: (report: DiagnosticReport) => void;
  onCompleted?: (
    reports: QuickPrepareReports,
    executionReport: ExecutionReport,
  ) => void | Promise<void>;
  dnsProviderId: DnsProviderId;
}) {
  const [phases, setPhases] = useState<PreparePhase[]>(() => resetPhases());
  const [reports, setReports] = useState<QuickPrepareReports>({});
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [currentStatus, setCurrentStatus] = useState("Aguardando preparo.");
  const [completedTasks, setCompletedTasks] = useState(0);
  const [totalTasks, setTotalTasks] = useState(0);
  const [finalExecutionReport, setFinalExecutionReport] = useState<ExecutionReport | null>(null);
  const activeRun = useRef(0);
  const cancelRequested = useRef(false);
  const phaseTaskTotals = useRef<Partial<Record<QuickPreparePhaseId, number>>>({});
  const phaseTaskCompleted = useRef<Partial<Record<QuickPreparePhaseId, number>>>({});
  const phaseHasUnavailable = useRef<Partial<Record<QuickPreparePhaseId, boolean>>>({});
  const reportActions = useRef<ExecutionReportAction[]>([]);
  const companionRunId = useRef<string | null>(null);
  const companionStartedAt = useRef<number | null>(null);
  const executionMode = HERMES_SAFE_TEST_MODE ? "dryRun" : "real";

  useEffect(() => {
    if (!open) {
      return;
    }

    activeRun.current += 1;
    const runId = activeRun.current;
    companionRunId.current = `prepare-${Date.now()}-${runKey}`;
    companionStartedAt.current = Date.now();
    cancelRequested.current = false;
    setPhases(resetPhases());
    setReports({});
    setLogs([]);
    setFinalExecutionReport(null);
    setCompletedTasks(0);
    const taskPlan = buildQuickPrepareTaskPlan({ dnsProviderId, executionMode });
    setTotalTasks(taskPlan.length);
    phaseTaskTotals.current = countTasksByPhase(taskPlan);
    phaseTaskCompleted.current = {};
    phaseHasUnavailable.current = {};
    reportActions.current = [];
    setRunStatus("running");
    setCurrentStatus("Montando fila real do Preparar PC.");
    void runPrepare(runId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runKey]);

  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const remainingProgress = Math.max(0, 100 - progress);
  const activePhase =
    phases.find((item) => item.status === "running") ??
    phases.find((item) => item.status === "pending");
  const canCancel = runStatus === "running" && !cancelRequested.current;
  const canClose = runStatus !== "running";
  const dnsProvider = getDnsProvider(dnsProviderId);
  const hasIssues = finalExecutionReport ? hasExecutionIssues(finalExecutionReport) : false;

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
      phase: "prepare",
      isRunning: status === "running" || status === "paused",
      progress: runStatus === "completed" ? 100 : progress,
      currentStep: currentStatus,
      currentDetail:
        runStatus === "completed"
          ? hasIssues
            ? "Há pendências. Consulte o relatório e repita a preparação."
            : HERMES_SAFE_TEST_MODE
              ? "Simulação concluída. A segunda etapa pode ser simulada sem reiniciar."
              : "Salve seu trabalho e reinicie quando estiver pronto."
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

  async function runPrepare(runId: number) {
    try {
      const nextReports = await runQuickPrepareExecutor(
        { dnsProviderId, executionMode },
        {
          shouldCancel: () => shouldStop(runId),
          onTaskStart: (update) => handleTaskStart(runId, update),
          onTaskComplete: (update) => handleTaskComplete(runId, update),
        },
      );

      if (shouldStop(runId)) {
        return;
      }

      setCurrentStatus("Confirmando ajustes no Windows.");
      const verifiedActions = await verifyExecutionActions(
        reportActions.current,
        HERMES_SAFE_TEST_MODE,
      );
      reportActions.current = verifiedActions;

      if (shouldStop(runId)) {
        return;
      }

      const hadUnavailableSteps = Object.values(phaseHasUnavailable.current).some(Boolean);
      const executionReport = buildExecutionReport({
        phase: "prepare",
        title: "Preparação da Máquina",
        safeMode: HERMES_SAFE_TEST_MODE,
        actions: verifiedActions,
        notes: [
          "Resultado da execução do Botão 1.",
          HERMES_SAFE_TEST_MODE
            ? "Modo teste: nenhuma alteração real foi aplicada."
            : "Modo real: ajustes implementados foram executados.",
          ...(hadUnavailableSteps
            ? ["Um ou mais itens ficaram indisponíveis durante a preparação - veja o log acima."]
            : []),
        ],
      });
      const incomplete = hasExecutionIssues(executionReport);
      setFinalExecutionReport(executionReport);
      setCurrentStatus("Salvando conclusão da Fase 1.");
      await onCompleted?.(nextReports, executionReport);
      setRunStatus("completed");
      setCurrentStatus(
        incomplete
          ? "Preparação com pendências. Confira o relatório e tente novamente."
          : HERMES_SAFE_TEST_MODE
            ? "Simulação concluída. Nenhum reinício necessário."
            : "Preparo concluído. Reinicie quando estiver pronto.",
      );
      appendLog("info", "Preparar PC finalizado.");
      if (!incomplete && !HERMES_SAFE_TEST_MODE) {
        appendLog("warning", "Reinício recomendado antes de executar Otimizar Tudo.");
      }
    } catch (error) {
      if (activeRun.current !== runId) {
        return;
      }

      setRunStatus("failed");
      setCurrentStatus("Preparo interrompido.");
      appendLog("error", error instanceof Error ? error.message : String(error));
      const partialReport = buildExecutionReport({
        phase: "prepare",
        title: "Preparação interrompida",
        safeMode: HERMES_SAFE_TEST_MODE,
        actions: [
          ...reportActions.current,
          {
            id: "prepare-interrupted",
            title: "Execução interrompida",
            detail: "Consulte as ações anteriores e a recuperação antes de tentar novamente.",
            phase: "prepare",
            status: "failed",
            outputs: [error instanceof Error ? error.message : String(error)],
            plannedCount: 1,
          },
        ],
        notes: [
          "Algumas ações anteriores podem ter sido aplicadas. Consulte Segurança e Recuperação.",
        ],
      });
      setFinalExecutionReport(partialReport);
      await onCompleted?.({}, partialReport);
    }
  }

  function handleTaskStart(runId: number, update: QuickPrepareTaskUpdate) {
    if (activeRun.current !== runId) {
      return;
    }

    setCurrentStatus(update.task.title);
    updatePhase(update.task.phaseId, {
      status: "running",
      outputs: [update.task.detail],
    });
    appendLog("info", `Iniciando: ${update.task.title}.`);
  }

  function handleTaskComplete(runId: number, update: QuickPrepareTaskUpdate) {
    if (activeRun.current !== runId) {
      return;
    }

    const phaseId = update.task.phaseId;
    phaseTaskCompleted.current[phaseId] = (phaseTaskCompleted.current[phaseId] ?? 0) + 1;
    if (update.status === "unavailable") {
      phaseHasUnavailable.current[phaseId] = true;
    }

    const totalForPhase = phaseTaskTotals.current[phaseId] ?? 1;
    const doneForPhase = phaseTaskCompleted.current[phaseId] ?? 0;
    const phaseDone = doneForPhase >= totalForPhase;
    const phaseStatus: PhaseStatus = phaseDone
      ? phaseHasUnavailable.current[phaseId]
        ? "unavailable"
        : "completed"
      : "running";

    setCompletedTasks(update.taskIndex + 1);
    if (update.reports?.diagnostic) {
      onDiagnostic?.(update.reports.diagnostic);
    }
    upsertReportAction(update);
    setReports((current) => ({ ...current, ...update.reports }));
    updatePhase(phaseId, {
      status: phaseStatus,
      outputs: appendPhaseOutput(update),
    });
    appendLog(
      update.status === "unavailable" ? "warning" : "info",
      `${update.task.title}: ${update.outputs[0] ?? "ok"}`,
    );
  }

  function upsertReportAction(update: QuickPrepareTaskUpdate) {
    const isScanOnly = update.task.realPolicy === "scanOnly";
    const isAdminOnly = update.task.realPolicy === "adminOnly";
    const action: ExecutionReportAction = {
      id: update.task.id,
      title: update.task.title,
      detail: update.task.detail,
      phase:
        phaseTemplates.find((item) => item.id === update.task.phaseId)?.title ??
        update.task.phaseId,
      status: quickPrepareReportStatus(update),
      outputs: update.outputs,
      plannedCount: quickPreparePlannedCount(update),
      technicalName: `QuickPrepare.${update.task.id}`,
      commandPreview: update.task.detail,
      method: isScanOnly ? "analysis" : isAdminOnly ? "admin-engine" : "engine",
      risk: isScanOnly ? "info" : isAdminOnly ? "medium" : "low",
      implemented: update.status !== "unavailable",
    };
    reportActions.current = [
      ...reportActions.current.filter((item) => item.id !== action.id),
      action,
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
    appendLog("warning", "Usuário cancelou Preparar PC.");
  }

  function shouldStop(runId: number) {
    if (activeRun.current !== runId) {
      return true;
    }
    if (!cancelRequested.current) {
      return false;
    }
    setRunStatus("cancelled");
    return true;
  }

  function updatePhase(phaseId: QuickPreparePhaseId, patch: Partial<PreparePhase>) {
    setPhases((current) =>
      current.map((item) => (item.id === phaseId ? { ...item, ...patch } : item)),
    );
  }

  function appendLog(level: LogItem["level"], message: string) {
    const id = crypto.randomUUID();
    setLogs((current) => [{ id, level, message }, ...current].slice(0, 7));
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-3 py-4 backdrop-blur-sm">
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-border/80 bg-card/95 text-card-foreground shadow-[0_30px_90px_-40px_rgba(15,23,42,0.55)] backdrop-blur-xl">
        <header className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_16px_34px_-22px_rgba(37,99,235,0.9)]">
              <Zap className="h-8 w-8" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold tracking-[0.22em] text-primary">PREPARAR PC</p>
              <h2 className="mt-1 text-2xl font-black leading-tight text-foreground">
                Um clique para deixar pronto
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{currentStatus}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={!canClose}
            aria-label="Fechar Preparar PC"
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
              {HERMES_SAFE_TEST_MODE ? "Validação segura" : "Preparação global"}
            </p>
            <h3 className="mt-2 text-xl font-black text-foreground">{currentStatus}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {runStatus === "completed"
                ? hasIssues
                  ? "A segunda etapa permanece bloqueada."
                  : "A Fase 1 foi concluída."
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
            <div className="mb-4 rounded-2xl border border-warning/25 bg-warning/10 px-4 py-3 text-warning">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-sm font-bold">
                    {HERMES_SAFE_TEST_MODE
                      ? "Modo teste ativo: o NEXT valida o que faria sem alterar o Windows."
                      : "Modo real: o NEXT executa os ajustes implementados."}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed">
                    Este fluxo usa CMD/PowerShell/Registro allowlistados por baixo: Game Mode,
                    GameDVR, DNS escolhido, visual gamer mínimo, limpeza, inicialização e processos
                    seguros.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
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
                    <PreparePhaseCard key={item.id} phase={item} />
                  ))}
                </div>

                {reports.gamerDependencyVerification && (
                  <GamerDependenciesPanel report={reports.gamerDependencyVerification} />
                )}

                {finalExecutionReport && <PrepareSuccessPanel report={finalExecutionReport} />}
              </div>

              <aside className="space-y-4">
                <div className="rounded-2xl border border-border/70 bg-background/72 p-4">
                  <h3 className="text-[11px] font-bold tracking-[0.18em] text-primary">RESUMO</h3>
                  <div className="mt-3 space-y-2 text-sm">
                    <SummaryLine
                      label="Saúde"
                      value={formatScore(reports.diagnostic?.healthScore)}
                    />
                    <SummaryLine
                      label="Passos"
                      value={totalTasks > 0 ? `${completedTasks}/${totalTasks}` : "Montando"}
                    />
                    <SummaryLine
                      label="Admin"
                      value={
                        reports.system ? (reports.system.isElevated ? "Sim" : "Não") : "Verificando"
                      }
                    />
                    <SummaryLine
                      label="Temporários"
                      value={reports.clean ? `${formatGb(reports.clean.totalGb)} GB` : "Aguardando"}
                    />
                    <SummaryLine
                      label="Inicialização"
                      value={
                        reports.startup
                          ? `${reports.startup.highImpactCount} alto impacto`
                          : "Aguardando"
                      }
                    />
                    <SummaryLine
                      label="VC++/DirectX"
                      value={
                        reports.gamerDependencyVerification
                          ? `${reports.gamerDependencyVerification.readyCount}/${reports.gamerDependencyVerification.totalPackages} prontas; ${reports.gamerDependencyVerification.installedLocallyCount} instaladas`
                          : "Aguardando"
                      }
                    />
                    <SummaryLine
                      label="DNS"
                      value={`${dnsProvider.label} ${dnsProvider.primary}`}
                    />
                    <SummaryLine
                      label="Processos"
                      value={
                        reports.gamer
                          ? `${reports.gamer.summary.suggestedToClose} sugeridos`
                          : "Aguardando"
                      }
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 bg-background/72 p-4">
                  <h3 className="text-[11px] font-bold tracking-[0.18em] text-primary">LOG</h3>
                  <div className="mt-3 space-y-2">
                    {logs.length > 0 ? (
                      logs.map((item) => <LogRow key={item.id} item={item} />)
                    ) : (
                      <p className="rounded-xl border border-dashed border-border bg-background/60 px-3 py-4 text-sm text-muted-foreground">
                        Aguardando primeira fase.
                      </p>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          </details>
        </div>

        {runStatus === "completed" && !hasIssues && !HERMES_SAFE_TEST_MODE && (
          <div className="border-t border-border/70 bg-background/78 px-5 py-4 lg:px-6">
            <RestartPrompt phase="prepare" />
          </div>
        )}

        <footer className="flex flex-col gap-3 border-t border-border/70 bg-background/78 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-success" />
            {HERMES_SAFE_TEST_MODE
              ? "Modo teste: nenhuma alteração real ou reinício."
              : "Modo real: reinicie o PC antes de executar o Botão 2."}
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
              {runStatus === "running" ? "Preparando" : "Concluir"}
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
    default:
      return "pending";
  }
}

function PreparePhaseCard({ phase }: { phase: PreparePhase }) {
  const Icon =
    phase.status === "running" ? Loader2 : phase.status === "completed" ? CheckCircle2 : phase.icon;

  return (
    <article className="rounded-2xl border border-border/70 bg-background/72 p-4">
      <div className="flex items-start gap-3">
        <span
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${phaseIconClass(
            phase.status,
          )}`}
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
              className={`rounded-full border px-2 py-1 text-[10px] font-bold ${phasePillClass(
                phase.status,
              )}`}
            >
              {phaseStatusLabel(phase.status)}
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

function PrepareSuccessPanel({ report }: { report: ExecutionReport }) {
  const hasIssues = hasExecutionIssues(report);
  return (
    <section className="overflow-hidden rounded-2xl border border-success/25 bg-success/10">
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
              {hasIssues ? "Preparação incompleta" : "Preparo concluído"}
            </h3>
            <p className="mt-1 text-sm font-medium text-muted-foreground">
              {hasIssues
                ? "Consulte as falhas no relatório. Resolva as pendências antes de avançar."
                : report.safeMode
                  ? "Simulação concluída. A segunda etapa de teste dispensa reinício."
                  : "Base do PC preparada com sucesso. Reinicie antes de executar o Botão 2."}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-right">
          <span className="rounded-xl border border-success/20 bg-background/70 px-3 py-2">
            <span className="block text-[9px] font-bold uppercase tracking-[0.12em] text-success">
              Base
            </span>
            <span className="block text-sm font-black text-foreground">
              {hasIssues ? "Incompleta" : "Pronta"}
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

function GamerDependenciesPanel({ report }: { report: GamerDependencyVerificationReport }) {
  const warning = report.warnings[0];

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
              Dependências gamer verificadas
            </h3>
            <p className="mt-1 text-[12px] text-muted-foreground">
              O NEXT cuida dos runtimes dentro dos botões principais, sem etapa manual.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-4">
          <DependencyStat label="Prontas" value={report.readyCount} tone="success" />
          <DependencyStat label="Instaladas" value={report.installedLocallyCount} tone="success" />
          <DependencyStat label="Pendentes" value={report.blockedCount} tone="warning" />
          <DependencyStat label="Total" value={report.totalPackages} tone="primary" />
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

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/70 px-3 py-2">
      <span className="text-[12px] font-bold text-muted-foreground">{label}</span>
      <span className="text-[12px] font-black text-foreground">{value}</span>
    </div>
  );
}

function LogRow({ item }: { item: LogItem }) {
  const className =
    item.level === "error"
      ? "border-destructive/20 bg-destructive/10 text-destructive"
      : item.level === "warning"
        ? "border-warning/25 bg-warning/10 text-warning"
        : "border-primary/20 bg-primary/10 text-primary";

  return (
    <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2">
      <div className="flex items-start gap-2">
        <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="flex-1 text-[12px] leading-relaxed text-foreground">{item.message}</p>
        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${className}`}>
          {item.level}
        </span>
      </div>
    </div>
  );
}

function phase(
  id: QuickPreparePhaseId,
  title: string,
  subtitle: string,
  icon: LucideIcon,
): PreparePhase {
  return {
    id,
    title,
    subtitle,
    icon,
    status: "pending",
    outputs: [],
  };
}

function resetPhases() {
  return phaseTemplates.map((item) => ({ ...item, status: "pending" as const, outputs: [] }));
}

function countTasksByPhase(tasks: Array<{ phaseId: QuickPreparePhaseId }>) {
  return tasks.reduce<Partial<Record<QuickPreparePhaseId, number>>>((totals, item) => {
    totals[item.phaseId] = (totals[item.phaseId] ?? 0) + 1;
    return totals;
  }, {});
}

function appendPhaseOutput(update: QuickPrepareTaskUpdate) {
  const firstOutput = update.outputs[0] ?? phaseStatusLabel(update.status);
  return [`${update.task.title}: ${firstOutput}`, ...update.outputs.slice(1, 3)];
}

function quickPrepareReportStatus(update: QuickPrepareTaskUpdate): ExecutionReportStatus {
  if (update.status === "unavailable") {
    return "unavailable";
  }
  if (update.task.realPolicy === "scanOnly") {
    return "scanned";
  }
  return HERMES_SAFE_TEST_MODE ? "simulated" : "applied";
}

function quickPreparePlannedCount(update: QuickPrepareTaskUpdate) {
  if (update.status === "unavailable") {
    return 1;
  }

  if (update.task.id === "check-admin") return 2;
  if (update.task.id === "scan-diagnostic") return 8;
  if (update.task.id === "scan-performance") return 4;
  if (update.task.id === "scan-advanced")
    return Math.max(1, update.reports?.advanced?.actions.length ?? 1);
  if (update.task.id === "scan-gamer-dependencies") {
    return Math.max(1, update.reports?.gamerDependencyVerification?.totalPackages ?? 1);
  }
  if (update.task.id === "install-gamer-dependencies") {
    return Math.max(1, update.reports?.gamerDependencyInstallResult?.actions.length ?? 1);
  }
  if (update.task.id === "scan-clean") return Math.max(1, update.reports?.clean?.items.length ?? 1);
  if (update.task.id === "apply-clean") {
    return Math.max(1, update.reports?.cleanResult?.plannedEntries ?? 1);
  }
  if (update.task.id === "scan-startup")
    return Math.max(1, update.reports?.startup?.totalItems ?? 1);
  if (update.task.id === "apply-startup") {
    return Math.max(1, update.reports?.startupResult?.selectedItems ?? 1);
  }
  if (update.task.id === "scan-processes") {
    return Math.max(1, update.reports?.gamer?.summary.suggestedToClose ?? 1);
  }
  if (update.task.id === "apply-processes") {
    return Math.max(1, update.reports?.gamerResult?.closedProcesses.length ?? 1);
  }
  if (update.task.id.startsWith("performance-")) {
    return Math.max(1, update.reports?.performanceResult?.appliedActions.length ?? 2);
  }
  if (update.task.id.startsWith("advanced-")) {
    return quickPrepareAdvancedActionWeight(update.task.id.replace("advanced-", ""));
  }

  return 1;
}

function quickPrepareAdvancedActionWeight(actionId: string) {
  const weights: Record<string, number> = {
    "enable-game-mode": 2,
    "disable-game-dvr": 2,
    "disable-xbox-game-bar-deep": 6,
    "set-visual-effects-gamer-minimal": 18,
    "disable-hibernation": 1,
    "disable-startup-delay": 1,
    "disable-advertising-id": 1,
    "disable-tailored-experiences": 1,
    "disable-consumer-features": 2,
    "disable-activity-history": 1,
    "disable-location-tracking": 1,
    "disable-recall-user": 1,
    "flush-dns-cache": 1,
    "dism-analyze-component-store": 1,
    "dism-start-component-cleanup": 1,
    "dism-check-netfx3": 1,
    "dism-check-directplay": 1,
    "check-gamer-dependencies": 6,
    "set-diagtrack-service-manual": 1,
    "set-mapsbroker-service-manual": 1,
    "set-dns-cloudflare": 3,
    "set-dns-google": 3,
    "set-dns-opendns": 3,
    "set-dns-quad9": 3,
    "set-dns-adguard": 3,
  };

  return weights[actionId] ?? 1;
}

function phaseIconClass(status: PhaseStatus) {
  if (status === "completed") return "bg-success/10 text-success";
  if (status === "running") return "bg-primary/10 text-primary";
  if (status === "unavailable") return "bg-warning/10 text-warning";
  if (status === "cancelled") return "bg-muted text-muted-foreground";
  return "bg-primary-soft text-primary";
}

function phasePillClass(status: PhaseStatus) {
  if (status === "completed") return "border-success/20 bg-success/10 text-success";
  if (status === "running") return "border-primary/20 bg-primary/10 text-primary";
  if (status === "unavailable") return "border-warning/25 bg-warning/10 text-warning";
  if (status === "cancelled") return "border-border bg-muted text-muted-foreground";
  return "border-border bg-muted text-muted-foreground";
}

function phaseStatusLabel(status: PhaseStatus) {
  if (status === "completed") return "Ok";
  if (status === "running") return "Rodando";
  if (status === "unavailable") return "Indisp.";
  if (status === "cancelled") return "Cancelado";
  return "Pendente";
}

function formatScore(value?: number) {
  return typeof value === "number" ? `${Math.round(value)}/100` : "Aguardando";
}

function formatGb(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}
