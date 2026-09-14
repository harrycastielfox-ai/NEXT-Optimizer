import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Lock, Power, Sparkles, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { QuickPrepareModal } from "@/components/optimization/QuickPrepareModal";
import { SmartOptimizeModal } from "@/components/optimization/SmartOptimizeModal";
import type { DiagnosticReport } from "@/lib/diagnostic";
import {
  buildExecutionCycleReport,
  HERMES_ACTION_TARGET,
  readExecutionCycleReport,
  readExecutionReport,
  type ExecutionCycleReport,
  type ExecutionReport,
  writeExecutionCycleReport,
  writeExecutionReport,
} from "@/lib/execution-report";
import { applyAdvancedActions } from "@/lib/advanced";
import { DNS_PROVIDERS, type DnsProviderId, type QuickPrepareReports } from "@/lib/quick-prepare";
import { HERMES_SAFE_TEST_MODE } from "@/lib/safe-mode";
import { readSystemBootContext, type SystemBootContext } from "@/lib/system";
import { getPrepareRebootStatus, hasExecutionIssues } from "@/lib/execution-outcome";

export const Route = createFileRoute("/otimizar")({
  component: OptimizeRoute,
});

const DEFAULT_DNS_PROVIDER_ID: DnsProviderId = "cloudflare";
const QUICK_PREPARE_STORAGE_KEY = "hermes.quickPrepare.gate.v1";
const RESTART_RECOMMENDATION_STORAGE_KEY = "hermes.quickPrepare.restartRecommendation.v1";

type QuickPrepareGate = {
  completedAt: string;
  dnsProviderId: DnsProviderId;
  safeMode: boolean;
  bootIdAtCompletion?: string;
  bootedAtAtCompletion?: string;
  // true when the run that produced this gate had steps marked unavailable/failed - e.g. no
  // Tauri backend, or a real command that couldn't apply. Lets the UI say so instead of
  // claiming a clean "Preparação concluída" when some steps didn't actually run.
  hasIssues?: boolean;
};

type RestartRecommendation = {
  phase: "prepare" | "optimize";
  requestedAt: string;
  completedAt?: string;
  reason: string;
};

function OptimizeRoute() {
  const [isQuickPrepareOpen, setIsQuickPrepareOpen] = useState(false);
  const [quickPrepareRunKey, setQuickPrepareRunKey] = useState(0);
  const [isSmartOptimizeOpen, setIsSmartOptimizeOpen] = useState(false);
  const [smartOptimizeRunKey, setSmartOptimizeRunKey] = useState(0);
  const [quickPrepareGate, setQuickPrepareGate] = useState<QuickPrepareGate | null>(null);
  const [restartRecommendation, setRestartRecommendation] = useState<RestartRecommendation | null>(
    null,
  );
  const [systemBootContext, setSystemBootContext] = useState<SystemBootContext | null>(null);
  const [executionCycleReport, setExecutionCycleReport] = useState<ExecutionCycleReport | null>(
    null,
  );
  const [dnsProviderId, setDnsProviderId] = useState<DnsProviderId>(DEFAULT_DNS_PROVIDER_ID);
  const [dnsApplyStatus, setDnsApplyStatus] = useState<"idle" | "working" | "done" | "error">(
    "idle",
  );
  const [dnsApplyMessage, setDnsApplyMessage] = useState<string | null>(null);

  useEffect(() => {
    const storedGate = readQuickPrepareGate();
    setQuickPrepareGate(storedGate);
    if (storedGate?.dnsProviderId) {
      setDnsProviderId(storedGate.dnsProviderId);
    }
    setRestartRecommendation(readRestartRecommendation());
    setExecutionCycleReport(readExecutionCycleReport({ safeMode: HERMES_SAFE_TEST_MODE }));
    void refreshSystemBootContext().then(setSystemBootContext);
  }, []);

  const prepareRebootStatus = getPrepareRebootStatus(
    quickPrepareGate,
    systemBootContext,
    HERMES_SAFE_TEST_MODE,
  );
  const prepareDone = Boolean(quickPrepareGate);
  const prepareHasIssues = Boolean(
    quickPrepareGate &&
    (quickPrepareGate.hasIssues !== false || quickPrepareGate.safeMode !== HERMES_SAFE_TEST_MODE),
  );
  const optimizeReady = prepareRebootStatus === "confirmed";
  const optimizeLocked = !quickPrepareGate || !optimizeReady;
  const optimizeReport = executionCycleReport?.reports.optimize;
  const optimizeDone =
    optimizeReport && !hasExecutionIssues(optimizeReport)
      ? optimizeReport.summary.completedActions
      : 0;
  const centralActionTarget = { value: `${HERMES_ACTION_TARGET} ações` };
  const currentPhaseText = getCurrentPhaseText({
    prepareDone,
    prepareHasIssues,
    optimizeReady,
    optimizeDone,
    restartRecommendation,
  });

  const handlePrepareNow = useCallback(() => {
    if (optimizeReady) {
      return;
    }
    setQuickPrepareRunKey((value) => value + 1);
    setIsQuickPrepareOpen(true);
  }, [optimizeReady]);

  const handleOptimizeNow = useCallback(async () => {
    const nextBootContext = await refreshSystemBootContext();
    setSystemBootContext(nextBootContext);

    if (
      !quickPrepareGate ||
      getPrepareRebootStatus(quickPrepareGate, nextBootContext, HERMES_SAFE_TEST_MODE) !==
        "confirmed"
    ) {
      return;
    }

    setSmartOptimizeRunKey((value) => value + 1);
    setIsSmartOptimizeOpen(true);
  }, [quickPrepareGate]);

  const handleApplyDnsNow = useCallback(async () => {
    const provider = DNS_PROVIDERS.find((item) => item.id === dnsProviderId);
    if (!provider) {
      return;
    }

    const userConfirmed =
      HERMES_SAFE_TEST_MODE ||
      window.confirm(`Aplicar DNS ${provider.label} (${provider.primary}) agora?`);
    if (!userConfirmed) {
      return;
    }

    setDnsApplyStatus("working");
    setDnsApplyMessage(null);

    try {
      const result = await applyAdvancedActions({
        confirmed: !HERMES_SAFE_TEST_MODE && userConfirmed,
        dryRun: HERMES_SAFE_TEST_MODE,
        actionIds: [provider.actionId],
      });
      const dnsAction = result.appliedActions.find((action) => action.id === provider.actionId);
      if (!dnsAction || !["applied", "dryRun"].includes(dnsAction.status)) {
        throw new Error(dnsAction?.message ?? "O motor não confirmou a aplicação do DNS.");
      }
      setDnsApplyStatus("done");
      setDnsApplyMessage(
        result.dryRun
          ? `Modo teste: DNS ${provider.label} validado, nada foi alterado de verdade.`
          : dnsAction.message,
      );
    } catch (nextError) {
      setDnsApplyStatus("error");
      setDnsApplyMessage(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [dnsProviderId]);

  const handleDiagnosticUpdate = useCallback((_report: DiagnosticReport) => {}, []);

  const handlePrepareCompleted = useCallback(
    async (_reports: QuickPrepareReports, executionReport: ExecutionReport) => {
      const nextBootContext = await refreshSystemBootContext();
      setSystemBootContext(nextBootContext);

      const nextGate: QuickPrepareGate = {
        completedAt: new Date().toISOString(),
        dnsProviderId,
        safeMode: HERMES_SAFE_TEST_MODE,
        bootIdAtCompletion: nextBootContext?.currentBootId,
        bootedAtAtCompletion: nextBootContext?.bootedAt,
        hasIssues: hasExecutionIssues(executionReport),
      };
      writeQuickPrepareGate(nextGate);
      setQuickPrepareGate(nextGate);

      const nextRestartRecommendation: RestartRecommendation = {
        phase: "prepare",
        requestedAt: new Date().toISOString(),
        reason: nextGate.hasIssues
          ? "Repita a preparação após resolver as pendências."
          : "Preparação concluída. Reinicie quando estiver pronto.",
      };
      writeRestartRecommendation(nextRestartRecommendation);
      setRestartRecommendation(nextRestartRecommendation);

      writeExecutionReport(executionReport);
      const nextCycle = buildExecutionCycleReport({
        prepare: executionReport,
      });
      writeExecutionCycleReport(nextCycle);
      setExecutionCycleReport(nextCycle);
    },
    [dnsProviderId],
  );

  const handleOptimizeCompleted = useCallback(
    (executionReport: ExecutionReport) => {
      const nextRestartRecommendation: RestartRecommendation = {
        phase: "optimize",
        requestedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        reason: hasExecutionIssues(executionReport)
          ? "Otimização com pendências. Consulte o relatório."
          : "Otimização finalizada.",
      };
      writeRestartRecommendation(nextRestartRecommendation);
      setRestartRecommendation(nextRestartRecommendation);

      writeExecutionReport(executionReport);
      const nextCycle = buildExecutionCycleReport({
        prepare: executionCycleReport?.reports.prepare,
        optimize: executionReport,
      });
      writeExecutionCycleReport(nextCycle);
      setExecutionCycleReport(nextCycle);
    },
    [executionCycleReport],
  );

  return (
    <div className="lightning-bg flex min-h-screen overflow-hidden text-white">
      <Sidebar />
      <main className="min-h-screen flex-1 overflow-y-auto px-6 py-6 xl:px-10">
        <div className="mx-auto flex w-full max-w-[1380px] flex-col gap-4">
          <section className="flex flex-col gap-3 xl:flex-row xl:items-stretch xl:justify-between">
            <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-card/45 px-4 py-3 shadow-[0_14px_42px_-36px_rgba(168,85,247,0.7)] backdrop-blur xl:max-w-[720px]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(216,180,254,0.14),transparent_30%),linear-gradient(120deg,rgba(255,255,255,0.05),transparent_54%)]" />
              <div className="relative flex min-h-[78px] flex-col justify-center">
                <span className="inline-flex h-5 w-fit items-center gap-1.5 rounded-full border border-purple-300/25 bg-purple-300/10 px-2.5 text-[8px] font-black uppercase tracking-[0.18em] text-purple-300">
                  <Sparkles className="h-3 w-3" />
                  NEXT Performance
                </span>
                <h1 className="mt-2 bg-gradient-to-r from-white via-fuchsia-100 to-purple-300 bg-clip-text text-[clamp(24px,2vw,31px)] font-black leading-none tracking-normal text-transparent drop-shadow-[0_0_16px_rgba(168,85,247,0.18)]">
                  Preparar e otimizar
                </h1>
                <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-slate-400">
                  Duas etapas em ordem, com reinício entre elas.
                </p>
              </div>
            </div>

            <div className="relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-card/82 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.18),0_16px_34px_-24px_rgba(168,85,247,0.5)] backdrop-blur xl:w-[430px]">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-purple-500/10 opacity-70" />
              <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-purple-500/15 text-purple-300">
                <Zap className="h-5 w-5" />
              </div>
              <div className="relative min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">
                  Status atual
                </p>
                <p className="mt-0.5 truncate text-[13px] font-black text-white">
                  {currentPhaseText.title}
                </p>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-400">
                  {currentPhaseText.description}
                </p>
              </div>
              <span className="sr-only">{centralActionTarget.value}</span>
            </div>
          </section>

          <section className="rounded-2xl border border-purple-400/20 bg-black/32 p-4 shadow-[0_16px_45px_rgba(168,85,247,0.1)]">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-purple-300">
                  DNS do jogador
                </p>
                <h2 className="mt-1 text-lg font-black text-white">Escolha seu provedor DNS</h2>
              </div>
              <div className="ml-auto flex flex-col items-end gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleApplyDnsNow()}
                  disabled={dnsApplyStatus === "working"}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-2.5 text-xs font-black uppercase tracking-wide text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:text-slate-950/70 ${
                    dnsApplyStatus === "working"
                      ? "animate-pulse shadow-[0_0_45px_rgba(52,211,153,0.75)]"
                      : "shadow-[0_14px_32px_rgba(52,211,153,0.35)] disabled:bg-emerald-400/30"
                  }`}
                >
                  {dnsApplyStatus === "working" ? "Aplicando..." : "Aplicar DNS agora"}
                </button>
                <p className="text-right text-xs text-slate-400">
                  Não precisa refazer a preparação do PC.
                </p>
              </div>
            </div>
            {dnsApplyMessage && (
              <p
                className={`mb-3 text-xs ${
                  dnsApplyStatus === "error" ? "text-red-400" : "text-slate-400"
                }`}
              >
                {dnsApplyMessage}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {DNS_PROVIDERS.map((provider) => {
                const selected = dnsProviderId === provider.id;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setDnsProviderId(provider.id);
                      setDnsApplyStatus("idle");
                      setDnsApplyMessage(null);
                    }}
                    className={`min-h-14 rounded-xl border px-4 py-2.5 text-left transition ${
                      selected
                        ? "border-emerald-400 bg-emerald-400/10 shadow-[0_8px_25px_rgba(52,211,153,0.12)]"
                        : "border-purple-400/15 bg-black/28 hover:border-purple-300/45"
                    }`}
                  >
                    <span
                      className={`block text-sm font-black ${
                        selected ? "text-emerald-300" : "text-white"
                      }`}
                    >
                      {provider.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-400">{provider.primary}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <StepPanel
              step="1"
              title="Preparar PC"
              description="Prepara a base do Windows antes da otimização."
              icon={Zap}
              status={
                prepareHasIssues
                  ? "Com pendências"
                  : optimizeReady
                    ? "Concluído"
                    : prepareDone
                      ? "Reinicie o PC"
                      : "Pronto"
              }
              actionLabel={
                prepareDone
                  ? prepareHasIssues
                    ? "Repetir preparação"
                    : "Preparação concluída"
                  : "Iniciar preparação"
              }
              items={[
                "Diagnóstico completo do sistema",
                "Otimização de rede e DNS:",
                "Desempenho visual e modo gamer",
                "Privacidade, inicialização e serviços",
              ]}
              dnsProviderLabel={
                DNS_PROVIDERS.find((provider) => provider.id === dnsProviderId)?.label ??
                "Selecionado"
              }
              disabled={prepareDone && !prepareHasIssues}
              completed={prepareDone && !prepareHasIssues}
              onAction={handlePrepareNow}
              testId="hermes-prepare-start"
            />

            <StepPanel
              step="2"
              title="Otimizar Tudo"
              description="Conclui o plano global após o novo boot."
              icon={Sparkles}
              status={optimizeReady ? "Liberado" : "Bloqueado"}
              actionLabel={
                optimizeReady
                  ? "Iniciar otimização"
                  : prepareHasIssues
                    ? "Resolva a preparação"
                    : "Aguardando preparação e reinício"
              }
              items={[
                "Limpeza inteligente e cache",
                "Inicialização e desempenho global",
                "Rede e serviços otimizados",
                "NEXT Engine: +100 alterações cirúrgicas",
              ]}
              disabled={optimizeLocked}
              locked={optimizeLocked}
              completed={optimizeDone > 0}
              onAction={handleOptimizeNow}
              testId="hermes-optimize-start"
            />
          </section>
          <div className="sr-only">
            <span data-testid="hermes-optimize-locked">Conclua a Fase 1 primeiro</span>
            <span data-testid="hermes-optimize-waiting-restart">
              Boot rápido, sistema e plano global. Rede, serviços sob demanda, Gamer e Fate Trigger.
            </span>
          </div>
        </div>
      </main>

      <QuickPrepareModal
        open={isQuickPrepareOpen}
        runKey={quickPrepareRunKey}
        onClose={() => setIsQuickPrepareOpen(false)}
        onDiagnostic={handleDiagnosticUpdate}
        onCompleted={handlePrepareCompleted}
        dnsProviderId={dnsProviderId}
      />
      <SmartOptimizeModal
        open={isSmartOptimizeOpen}
        runKey={smartOptimizeRunKey}
        onClose={() => setIsSmartOptimizeOpen(false)}
        onCompleted={handleOptimizeCompleted}
      />
    </div>
  );
}

function StepPanel({
  step,
  title,
  description,
  items,
  dnsProviderLabel,
  icon: Icon,
  status,
  actionLabel,
  disabled = false,
  locked = false,
  completed = false,
  onAction,
  testId,
}: {
  step: string;
  title: string;
  description: string;
  items: string[];
  dnsProviderLabel?: string;
  icon: typeof Zap;
  status: string;
  actionLabel: string;
  disabled?: boolean;
  locked?: boolean;
  completed?: boolean;
  onAction: () => void;
  testId: string;
}) {
  return (
    <article className="relative flex flex-col overflow-hidden rounded-2xl border border-purple-400/20 bg-black/36 p-5 shadow-[0_18px_55px_rgba(168,85,247,0.11)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(192,132,252,0.13),transparent_34%)]" />
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid size-11 place-items-center rounded-xl bg-purple-500 text-lg font-black text-white shadow-[0_12px_30px_rgba(192,132,252,0.25)]">
            {step}
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-purple-300">
              Etapa {step}
            </p>
            <h2 className="mt-0.5 text-xl font-black tracking-tight text-white">{title}</h2>
          </div>
        </div>

        <span className="inline-flex items-center gap-2 rounded-full border border-purple-400/20 bg-black/35 px-3 py-1.5 text-xs font-black text-purple-100">
          {locked ? (
            <Lock className="size-4" />
          ) : completed ? (
            <CheckCircle2 className="size-4" />
          ) : null}
          {status}
        </span>
      </div>

      <div className="relative mt-4 flex flex-1 flex-col rounded-xl border border-purple-400/12 bg-black/28 p-4">
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-purple-500/18 text-purple-200">
            <Icon className="size-5" />
          </div>
          <p className="text-sm text-slate-300">{description}</p>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {items.map((item, index) => {
            const featured = step === "2" && index === 3;
            const dnsSelection = step === "1" && index === 1 && dnsProviderLabel;
            return (
              <div
                key={item}
                className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 ${
                  featured
                    ? "border-purple-400/50 bg-purple-500/15 shadow-[0_8px_24px_rgba(168,85,247,0.18)]"
                    : "border-white/5 bg-white/[0.025]"
                }`}
              >
                <span
                  className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${
                    featured ? "bg-purple-400 text-white" : "bg-purple-500/20 text-purple-200"
                  }`}
                >
                  {index + 1}
                </span>
                {dnsSelection ? (
                  <span className="flex min-w-0 flex-1 flex-col items-center text-center">
                    <span className="text-xs font-bold text-slate-200">{item}</span>
                    <span className="mt-0.5 text-xs font-black text-emerald-300 drop-shadow-[0_0_8px_rgba(52,211,153,0.7)]">
                      {dnsProviderLabel}
                    </span>
                  </span>
                ) : (
                  <span
                    className={`text-xs font-bold ${
                      featured ? "text-purple-100" : "text-slate-200"
                    }`}
                  >
                    {item}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          data-testid={testId}
          onClick={onAction}
          disabled={disabled}
          className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-purple-400 px-5 text-sm font-black text-white shadow-[0_14px_36px_rgba(192,132,252,0.26)] transition hover:bg-purple-300 disabled:cursor-not-allowed disabled:bg-purple-400/30 disabled:text-white/55"
        >
          {locked ? <Lock className="size-5" /> : <Power className="size-5" />}
          {actionLabel}
        </button>
      </div>
    </article>
  );
}

function getCurrentPhaseText({
  prepareDone,
  prepareHasIssues,
  optimizeReady,
  optimizeDone,
  restartRecommendation,
}: {
  prepareDone: boolean;
  prepareHasIssues: boolean;
  optimizeReady: boolean;
  optimizeDone: number;
  restartRecommendation: RestartRecommendation | null;
}) {
  if (optimizeDone > 0) {
    return {
      title: "Otimização concluída",
      description: "O fluxo principal já foi finalizado neste computador.",
    };
  }

  if (optimizeReady) {
    return {
      title: "Botão 2 liberado",
      description: HERMES_SAFE_TEST_MODE
        ? "Preparação simulada concluída. Você pode simular a segunda etapa sem reiniciar."
        : "A preparação foi concluída em um boot anterior. Você pode finalizar agora.",
    };
  }

  if (prepareDone || restartRecommendation?.phase === "prepare") {
    return {
      title: prepareHasIssues ? "Preparação com pendências" : "Reinício necessário",
      description: prepareHasIssues
        ? "Confira o relatório e repita a preparação. A segunda etapa permanece bloqueada."
        : "Reinicie o computador para liberar a segunda etapa.",
    };
  }

  return {
    title: "Pronto para começar",
    description: "Inicie pelo Botão 1 e siga a ordem indicada na tela.",
  };
}

function readQuickPrepareGate(): QuickPrepareGate | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(QUICK_PREPARE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as QuickPrepareGate;
    if (!parsed.completedAt) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeQuickPrepareGate(gate: QuickPrepareGate) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(QUICK_PREPARE_STORAGE_KEY, JSON.stringify(gate));
}

function readRestartRecommendation(): RestartRecommendation | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(RESTART_RECOMMENDATION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as RestartRecommendation;
    if (!parsed.phase || !parsed.requestedAt) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeRestartRecommendation(recommendation: RestartRecommendation) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(RESTART_RECOMMENDATION_STORAGE_KEY, JSON.stringify(recommendation));
}

async function refreshSystemBootContext(): Promise<SystemBootContext | null> {
  try {
    return await readSystemBootContext();
  } catch {
    return null;
  }
}
