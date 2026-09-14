import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  HardDrive,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { refreshAdvisorAiReport, type AdvisorAiReport } from "@/lib/advisor-ai";
import { refreshCleanScanReport, type CleanScanReport } from "@/lib/clean";
import { refreshDiagnosticReport, type DiagnosticReport } from "@/lib/diagnostic";
import { loadGamerReport } from "@/lib/gamer";
import { refreshPerformanceReport } from "@/lib/performance";
import { refreshStartupReport } from "@/lib/startup";

type StageStatus = "pending" | "running" | "completed" | "unavailable" | "failed" | "cancelled";
type RunStatus = "idle" | "running" | "completed" | "cancelled" | "failed";

type AnalysisStage = {
  id: string;
  title: string;
  engine: string;
  description: string;
  status: StageStatus;
  source: string;
  outputs: string[];
};

type AnalysisLog = {
  id: string;
  level: "info" | "warning" | "error";
  message: string;
};

const stageTemplates: AnalysisStage[] = [
  stage(
    "diagnostic",
    "Analisando sistema",
    "Diagnóstico",
    "Coleta CPU, RAM, disco, hardware, Windows, rede e segurança.",
  ),
  stage(
    "startup",
    "Lendo inicialização",
    "Inicialização",
    "Classifica os aplicativos que iniciam com o Windows sem desativar nenhum item.",
  ),
  stage(
    "cleanup",
    "Mapeando arquivos temporários",
    "Limpeza",
    "Calcula apenas candidatos seguros. Nenhum arquivo e movido ou excluido.",
  ),
  stage(
    "performance",
    "Avaliando desempenho",
    "Performance",
    "Lê plano de energia, Modo Jogo e configurações visuais sem aplicar ajustes.",
  ),
  stage(
    "applications",
    "Detectando jogos e aplicativos",
    "Perfis",
    "Identifica jogos, processos protegidos e oportunidades para perfis futuros.",
  ),
  stage(
    "advisor",
    "Gerando recomendações",
    "NEXT Insight",
    "Cruza as fontes locais e produz recomendações explicaveis.",
  ),
];

const STAGE_TIMEOUT_MS = 30_000;

export function GlobalAnalysisModal({
  open,
  runKey,
  onClose,
  onDiagnostic,
}: {
  open: boolean;
  runKey: number;
  onClose: () => void;
  onDiagnostic: (report: DiagnosticReport) => void;
}) {
  const [stages, setStages] = useState<AnalysisStage[]>(() => resetStages());
  const [logs, setLogs] = useState<AnalysisLog[]>([]);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [currentStatus, setCurrentStatus] = useState("Aguardando analise.");
  const cancelRequested = useRef(false);
  const activeRun = useRef(0);

  useEffect(() => {
    if (!open) {
      return;
    }

    activeRun.current += 1;
    const runId = activeRun.current;
    cancelRequested.current = false;
    setStages(resetStages());
    setLogs([]);
    setHighlights([]);
    setRunStatus("running");
    setCurrentStatus("Preparando diagnóstico global somente leitura.");
    void runAnalysis(runId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runKey]);

  const processedStages = useMemo(
    () => stages.filter((item) => item.status !== "pending" && item.status !== "running").length,
    [stages],
  );
  const progress = Math.round((processedStages / stages.length) * 100);
  const activeStage = stages.find((item) => item.status === "running");

  async function runAnalysis(runId: number) {
    const nextHighlights: string[] = [];

    try {
      await executeStage(runId, "diagnostic", async () => {
        const diagnostic = await refreshDiagnosticReport();
        assertReadOnly("Diagnostic Engine", diagnostic.readOnly);
        onDiagnostic(diagnostic);

        nextHighlights.push(`${Math.round(diagnostic.healthScore)}/100 de saúde geral`);
        nextHighlights.push(
          `${formatGb(diagnostic.disk.freeGb)} GB livres no disco ${diagnostic.disk.mount}`,
        );
        setHighlights([...nextHighlights]);

        return resultFromAvailability(
          hasRealData(diagnostic.generatedAt),
          "Diagnóstico completo salvo no histórico local.",
          [
            `CPU: ${Math.round(diagnostic.cpu.usagePercent)}%`,
            `RAM: ${Math.round(diagnostic.ram.usedPercent)}% em uso`,
            `Disco: ${Math.round(diagnostic.disk.usedPercent)}% em uso`,
            `Segurança: ${diagnostic.defender.status}`,
          ],
        );
      });

      if (shouldStop(runId)) return;

      await executeStage(runId, "startup", async () => {
        const startup = await refreshStartupReport();
        assertReadOnly("Startup Engine", startup.readOnly);
        nextHighlights.push(`${startup.totalItems} itens de inicialização detectados`);
        setHighlights([...nextHighlights]);

        return resultFromAvailability(
          hasRealData(startup.generatedAt),
          "Inicialização analisada sem alterar aplicativos.",
          [
            `${startup.highImpactCount} de alto impacto`,
            `${startup.mediumImpactCount} de médio impacto`,
            `${startup.disabledItems} ja desativado(s)`,
          ],
        );
      });

      if (shouldStop(runId)) return;

      await executeStage(runId, "cleanup", async () => {
        const clean = await refreshCleanScanReport();
        assertCleanScanOnly(clean);
        nextHighlights.push(`${formatGb(clean.totalGb)} GB candidatos à revisão`);
        setHighlights([...nextHighlights]);

        return resultFromAvailability(
          hasRealData(clean.generatedAt),
          "Arquivos temporários apenas mapeados.",
          [
            `${clean.items.length} área(s) analisada(s)`,
            `${formatGb(clean.totalGb)} GB encontrados`,
            "Nenhum arquivo movido ou excluido",
          ],
        );
      });

      if (shouldStop(runId)) return;

      await executeStage(runId, "performance", async () => {
        const performance = await refreshPerformanceReport();
        assertReadOnly("Performance Engine", performance.readOnly && !performance.willModifySystem);
        nextHighlights.push(`Plano atual: ${performance.powerPlan.activeSchemeName}`);
        setHighlights([...nextHighlights]);

        return resultFromAvailability(
          hasRealData(performance.generatedAt),
          "Configurações de desempenho avaliadas sem ajustes.",
          [
            `Plano de energia: ${performance.powerPlan.activeSchemeName}`,
            `Modo Jogo: ${performance.gameMode.status}`,
            `Efeitos visuais: ${performance.visualEffects.status}`,
          ],
        );
      });

      if (shouldStop(runId)) return;

      await executeStage(runId, "applications", async () => {
        const gamer = await loadGamerReport();
        assertReadOnly("Gamer Engine", gamer.readOnly && !gamer.willModifySystem);
        nextHighlights.push(`${gamer.summary.detectedGames} jogo(s) detectado(s)`);
        setHighlights([...nextHighlights]);

        return resultFromAvailability(
          hasRealData(gamer.generatedAt),
          "Jogos e processos relevantes identificados sem fechar aplicativos.",
          [
            `${gamer.summary.detectedGames} jogo(s) detectado(s)`,
            `${gamer.summary.protectedCount} processo(s) protegido(s)`,
            `${gamer.summary.suggestedToClose} sugestão(ões) para futura revisão`,
          ],
        );
      });

      if (shouldStop(runId)) return;

      await executeStage(runId, "advisor", async () => {
        const advisor = await refreshAdvisorAiReport();
        assertReadOnly("NEXT Insight", advisor.readOnly && !advisor.willModifySystem);

        if (advisor.hermesScore.value !== null) {
          nextHighlights.push(`Score NEXT: ${advisor.hermesScore.value}/100`);
        }
        if (advisor.summary.recommendedProfile) {
          nextHighlights.push(`Perfil sugerido: ${advisor.summary.recommendedProfile}`);
        }
        setHighlights([...nextHighlights]);

        return advisorResult(advisor);
      });

      if (activeRun.current !== runId) {
        return;
      }

      setRunStatus("completed");
      setCurrentStatus("Análise global concluída e salva no Dashboard.");
      appendLog("info", "Análise concluída. Nenhuma alteração foi aplicada ao Windows.");
    } catch (error) {
      if (activeRun.current !== runId) {
        return;
      }

      setRunStatus("failed");
      setCurrentStatus("Análise interrompida sem alterar o computador.");
      appendLog("error", `ERRO | ${errorMessage(error)}`);
    }
  }

  async function executeStage(
    runId: number,
    stageId: string,
    task: () => Promise<StageExecutionResult>,
  ) {
    if (shouldStop(runId)) {
      return;
    }

    const template = stageTemplates.find((item) => item.id === stageId);
    updateStage(stageId, {
      status: "running",
      source: "Coleta local",
      outputs: ["Aguardando resposta da engine local."],
    });
    setCurrentStatus(template?.title ?? "Executando etapa.");
    appendLog("info", `Iniciando: ${template?.title ?? stageId}.`);

    try {
      const result = await withStageTimeout(task(), stageId);
      if (activeRun.current !== runId) {
        return;
      }

      updateStage(stageId, {
        status: result.status,
        source: result.source,
        outputs: result.outputs,
      });
      appendLog(result.status === "unavailable" ? "warning" : "info", result.message);
    } catch (error) {
      updateStage(stageId, {
        status: "failed",
        source: "Falha segura",
        outputs: [errorMessage(error)],
      });
      throw error;
    }
  }

  function requestCancel() {
    cancelRequested.current = true;
    setRunStatus("cancelled");
    setCurrentStatus("Cancelamento solicitado. A analise parara antes da próxima etapa.");
    setStages((current) =>
      current.map((item) =>
        item.status === "pending"
          ? { ...item, status: "cancelled", source: "Cancelado pelo usuário" }
          : item,
      ),
    );
    appendLog("warning", "Usuário solicitou o cancelamento da analise.");
  }

  function shouldStop(runId: number) {
    if (activeRun.current !== runId) {
      return true;
    }

    if (!cancelRequested.current) {
      return false;
    }

    setRunStatus("cancelled");
    setCurrentStatus("Análise cancelada sem executar novas etapas.");
    return true;
  }

  function updateStage(stageId: string, patch: Partial<AnalysisStage>) {
    setStages((current) =>
      current.map((item) => (item.id === stageId ? { ...item, ...patch } : item)),
    );
  }

  function appendLog(level: AnalysisLog["level"], message: string) {
    const id = crypto.randomUUID();
    setLogs((current) => [{ id, level, message }, ...current].slice(0, 8));
  }

  if (!open) {
    return null;
  }

  const canCancel = runStatus === "running" && !cancelRequested.current;
  const canClose = runStatus !== "running" || cancelRequested.current;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/25 px-3 py-4 backdrop-blur-sm">
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-white/80 bg-white/92 shadow-[0_30px_90px_-40px_rgba(15,23,42,0.50)] backdrop-blur-xl">
        <div className="relative flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/80 bg-white shadow-[0_14px_34px_-22px_rgba(15,23,42,0.65)]">
              <img
                src="/nex-logo.png"
                alt="NEXT Optimizer"
                className="h-full w-full object-contain p-1.5"
              />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold tracking-[0.22em] text-primary">
                DIAGNOSTICO GLOBAL
              </p>
              <h2 className="mt-1 text-2xl font-bold leading-tight text-foreground">
                Analisar Agora
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeStage?.title ?? currentStatus}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={!canClose}
            aria-label="Fechar analise global"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-white/80 text-muted-foreground transition hover:bg-muted disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative overflow-auto px-5 py-5 lg:px-6">
          <div className="mb-4 rounded-2xl border border-success/25 bg-success/10 px-4 py-3 text-success">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="text-sm font-bold">Análise 100% somente leitura</p>
                <p className="mt-1 text-[12px] leading-relaxed">
                  O NEXT coleta e salva informações locais. Nenhum arquivo, processo ou ajuste do
                  Windows será alterado.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/70 bg-white/72 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] font-bold tracking-[0.18em] text-primary">
                      PROGRESSO GERAL
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{currentStatus}</p>
                  </div>
                  <div className="flex items-center gap-2 rounded-full border border-primary/15 bg-primary/8 px-3 py-1.5 text-sm font-bold text-primary">
                    {runStatus === "running" && <Loader2 className="h-4 w-4 animate-spin" />}
                    {progress}%
                  </div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                {stages.map((item, index) => (
                  <StageRow key={item.id} index={index + 1} stage={item} />
                ))}
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-border/70 bg-white/72 p-4">
                <h3 className="text-[11px] font-bold tracking-[0.18em] text-primary">
                  RESUMO ENCONTRADO
                </h3>
                <div className="mt-3 space-y-2">
                  {highlights.length > 0 ? (
                    highlights.slice(0, 7).map((item) => (
                      <div
                        key={item}
                        className="flex items-start gap-2 rounded-xl border border-border/60 bg-white/70 px-3 py-2 text-sm text-foreground"
                      >
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{item}</span>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-xl border border-dashed border-border bg-white/60 px-3 py-4 text-sm text-muted-foreground">
                      Os dados aparecerao conforme as engines responderem.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-white/72 p-4">
                <h3 className="text-[11px] font-bold tracking-[0.18em] text-primary">
                  DADOS E PRIVACIDADE
                </h3>
                <div className="mt-3 space-y-2 text-[12px] text-muted-foreground">
                  <SafetyRow text="Coleta executada localmente." />
                  <SafetyRow text="Resultado salvo no histórico do NEXT." />
                  <SafetyRow text="Sem telemetria ou envio para nuvem." />
                  <SafetyRow text="Nenhuma configuração será alterada." />
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-white/72 p-4">
                <h3 className="text-[11px] font-bold tracking-[0.18em] text-primary">LOGS</h3>
                <div className="mt-3 space-y-2">
                  {logs.length > 0 ? (
                    logs.map((item) => <LogRow key={item.id} log={item} />)
                  ) : (
                    <p className="rounded-xl border border-dashed border-border bg-white/60 px-3 py-4 text-sm text-muted-foreground">
                      Aguardando primeira etapa.
                    </p>
                  )}
                </div>
              </div>
            </aside>
          </div>
        </div>

        <div className="relative flex flex-col gap-3 border-t border-border/70 bg-white/78 px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-success" />
            Somente leitura. Nenhuma ação de limpeza ou otimização será executada.
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {canCancel && (
              <button
                type="button"
                onClick={requestCancel}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-white px-4 text-sm font-semibold text-foreground transition hover:bg-muted"
              >
                Cancelar analise
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={!canClose}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_12px_28px_-18px_rgba(37,99,235,0.9)] transition hover:bg-primary/95 disabled:opacity-50"
            >
              {runStatus === "running" ? (
                <Clock3 className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              {runStatus === "running" ? "Analisando" : "Concluir"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type StageExecutionResult = {
  status: "completed" | "unavailable";
  source: string;
  message: string;
  outputs: string[];
};

function resultFromAvailability(
  available: boolean,
  message: string,
  outputs: string[],
): StageExecutionResult {
  return {
    status: available ? "completed" : "unavailable",
    source: available ? "Engine local" : "Dados indisponíveis",
    message: available ? message : "A engine não retornou dados reais nesta execução.",
    outputs,
  };
}

function advisorResult(advisor: AdvisorAiReport): StageExecutionResult {
  const available =
    hasRealData(advisor.generatedAt) && advisor.hermesScore.status !== "unavailable";
  const score =
    advisor.hermesScore.value === null ? "Indisponível" : `${advisor.hermesScore.value}/100`;

  return resultFromAvailability(available, "Recomendações locais geradas e salvas.", [
    `Score NEXT: ${score}`,
    `${advisor.recommendations.length} recomendação(ões)`,
    `Confianca: ${advisor.summary.confidence}`,
    advisor.summary.recommendedProfile
      ? `Perfil sugerido: ${advisor.summary.recommendedProfile}`
      : "Perfil sugerido: aguardando dados suficientes",
  ]);
}

function assertReadOnly(engine: string, readOnly: boolean) {
  if (!readOnly) {
    throw new Error(`${engine} recusada: a etapa não confirmou modo somente leitura.`);
  }
}

function assertCleanScanOnly(report: CleanScanReport) {
  if (!report.readOnly || report.willDeleteFiles) {
    throw new Error("Clean Engine recusada: a etapa tentou sair do modo de varredura.");
  }
}

async function withStageTimeout(
  task: Promise<StageExecutionResult>,
  stageId: string,
): Promise<StageExecutionResult> {
  let timer: number | undefined;

  try {
    return await Promise.race([
      task,
      new Promise<StageExecutionResult>((resolve) => {
        timer = window.setTimeout(() => {
          resolve({
            status: "unavailable",
            source: "Tempo limite",
            message: `A etapa ${stageId} excedeu ${STAGE_TIMEOUT_MS / 1000}s.`,
            outputs: [
              "A interface foi liberada com segurança.",
              "Nenhuma alteração foi executada.",
            ],
          });
        }, STAGE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
  }
}

function StageRow({ stage: item, index }: { stage: AnalysisStage; index: number }) {
  const Icon = stageIcon(item.status);

  return (
    <div className="rounded-2xl border border-border/70 bg-white/72 px-4 py-3">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${stageIconClass(item.status)}`}
        >
          <Icon className={`h-5 w-5 ${item.status === "running" ? "animate-spin" : ""}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-bold tracking-wider text-muted-foreground">
                ETAPA {index} - {item.engine}
              </p>
              <h3 className="mt-0.5 text-sm font-bold text-foreground">{item.title}</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            </div>
            <span
              className={`w-fit shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${stagePillClass(item.status)}`}
            >
              {stageStatusLabel(item.status)}
            </span>
          </div>
          {item.outputs.length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {item.outputs.slice(0, 4).map((output, index) => (
                <div
                  key={`${item.id}-${index}`}
                  className="rounded-lg border border-border/60 bg-slate-50/80 px-2.5 py-2 text-[11px] font-medium text-foreground"
                >
                  {output}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SafetyRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-white/70 px-3 py-2">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      <span>{text}</span>
    </div>
  );
}

function LogRow({ log }: { log: AnalysisLog }) {
  const badgeClass =
    log.level === "error"
      ? "border-destructive/20 bg-destructive/10 text-destructive"
      : log.level === "warning"
        ? "border-warning/25 bg-warning/10 text-warning"
        : "border-primary/20 bg-primary/10 text-primary";

  return (
    <div className="rounded-xl border border-border/60 bg-white/70 px-3 py-2">
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="flex-1 text-[12px] leading-relaxed text-foreground">{log.message}</p>
        <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${badgeClass}`}>
          {log.level}
        </span>
      </div>
    </div>
  );
}

function resetStages(): AnalysisStage[] {
  return stageTemplates.map((item) => ({
    ...item,
    status: "pending",
    source: "Aguardando",
    outputs: [],
  }));
}

function stage(id: string, title: string, engine: string, description: string): AnalysisStage {
  return {
    id,
    title,
    engine,
    description,
    status: "pending",
    source: "Aguardando",
    outputs: [],
  };
}

function stageIcon(status: StageStatus) {
  if (status === "running") return Loader2;
  if (status === "completed") return CheckCircle2;
  if (status === "unavailable") return HardDrive;
  if (status === "failed") return AlertTriangle;
  if (status === "cancelled") return X;
  return Search;
}

function stageIconClass(status: StageStatus) {
  if (status === "completed") return "bg-success/10 text-success";
  if (status === "unavailable") return "bg-warning/10 text-warning";
  if (status === "failed") return "bg-destructive/10 text-destructive";
  if (status === "cancelled") return "bg-muted text-muted-foreground";
  if (status === "running") return "bg-primary/10 text-primary";
  return "bg-primary-soft text-primary";
}

function stagePillClass(status: StageStatus) {
  if (status === "completed") return "border-success/20 bg-success/10 text-success";
  if (status === "unavailable") return "border-warning/25 bg-warning/10 text-warning";
  if (status === "failed") return "border-destructive/20 bg-destructive/10 text-destructive";
  if (status === "cancelled") return "border-border bg-muted text-muted-foreground";
  if (status === "running") return "border-primary/20 bg-primary/10 text-primary";
  return "border-border bg-muted/60 text-muted-foreground";
}

function stageStatusLabel(status: StageStatus) {
  if (status === "running") return "Analisando";
  if (status === "completed") return "Concluído";
  if (status === "unavailable") return "Indisponível";
  if (status === "failed") return "Falha";
  if (status === "cancelled") return "Cancelado";
  return "Pendente";
}

function hasRealData(generatedAt: string) {
  return generatedAt !== "0" && generatedAt.trim().length > 0;
}

function formatGb(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
