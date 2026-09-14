import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, LockKeyhole, Power, RefreshCw, Shield, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import {
  analyzeAntiCheat,
  enableMemoryIntegrity,
  fallbackAntiCheatReport,
  loadCachedAntiCheatReport,
  type AntiCheatActivationResult,
  type AntiCheatCheck,
  type AntiCheatReport,
} from "@/lib/anti-cheat";
import { requestSystemRestart, type SystemRestartResult } from "@/lib/system";

export const Route = createFileRoute("/anti-cheat")({
  head: () => ({
    meta: [
      { title: "NEXT Optimizer - Anti-Cheat" },
      { name: "description", content: "Compatibilidade local com anti-cheats modernos." },
    ],
  }),
  component: AntiCheatPage,
});

function AntiCheatPage() {
  const [report, setReport] = useState<AntiCheatReport>(fallbackAntiCheatReport);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    setReport(loadCachedAntiCheatReport());
  }, []);

  const executeAnalysis = useCallback(async () => {
    if (isRunning) return;

    setIsRunning(true);
    try {
      setReport(await analyzeAntiCheat());
    } finally {
      setIsRunning(false);
    }
  }, [isRunning]);

  return (
    <div className="lightning-bg min-h-screen flex">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 overflow-auto px-5 pb-4 pt-6 xl:px-8 xl:pt-7">
          <div className="mb-6">
            <p className="mb-2 text-xs font-bold tracking-[0.22em] text-primary">
              COMPATIBILIDADE COMPETITIVA
            </p>
            <h1 className="text-[clamp(26px,2vw,32px)] font-bold leading-tight tracking-tight text-foreground">
              Anti-Cheat
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Verifique TPM, Secure Boot, integridade do sistema e servicos de jogos sem alterar o
              Windows.
            </p>
          </div>

          <AntiCheatCard report={report} isRunning={isRunning} onAnalyze={executeAnalysis} />
        </main>
      </div>
    </div>
  );
}

function AntiCheatCard({
  report,
  isRunning,
  onAnalyze,
}: {
  report: AntiCheatReport;
  isRunning: boolean;
  onAnalyze: () => Promise<void> | void;
}) {
  const [activation, setActivation] = useState<ActivationUiState | null>(null);
  const hasAnalyzed = report.generatedAt !== "0";
  const showActivationGuide = false;
  const checklist = [
    report.checks.tpm,
    report.checks.secureBoot,
    report.checks.coreIsolation,
    report.checks.driverSignature,
    report.services.riotVanguard,
    report.services.easyAntiCheat,
    report.services.faceit,
    report.services.battleye,
  ];
  const activationItems = hasAnalyzed ? buildActivationItems(report) : [];

  const runActivation = useCallback(async () => {
    setActivation({
      phase: "running",
      progress: 8,
      title: "Ativando compatibilidade",
      message: "Validando Integridade de Memoria e permissao administrativa.",
    });

    let progress = 8;
    const timer = window.setInterval(() => {
      progress = Math.min(progress + 7, 92);
      setActivation((current) =>
        current?.phase === "running" ? { ...current, progress } : current,
      );
    }, 180);

    try {
      const result = await enableMemoryIntegrity();
      window.clearInterval(timer);
      setActivation({
        phase: "done",
        progress: 100,
        title: result.restartRequired ? "Reinicio necessario" : "Compatibilidade validada",
        message: result.restartRequired
          ? "Voce deve reiniciar para ativar as funcoes."
          : result.message,
        result,
      });

      await onAnalyze();
    } catch (error) {
      window.clearInterval(timer);
      setActivation({
        phase: "error",
        progress: 100,
        title: "Nao foi possivel concluir",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [onAnalyze]);

  const requestRestart = useCallback(async () => {
    setActivation((current) =>
      current
        ? {
            ...current,
            phase: "restarting",
            message: "Agendando reinicio pelo Windows em 5 segundos.",
          }
        : current,
    );

    try {
      const restart = await requestSystemRestart({
        confirmed: true,
        dryRun: false,
        delaySeconds: 5,
      });
      setActivation((current) =>
        current
          ? {
              ...current,
              phase: "done",
              restart,
              message: restart.message,
            }
          : current,
      );
    } catch (error) {
      setActivation((current) =>
        current
          ? {
              ...current,
              phase: "error",
              message: error instanceof Error ? error.message : String(error),
            }
          : current,
      );
    }
  }, []);

  return (
    <section className="max-w-5xl rounded-2xl border border-border/60 bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft">
              <LockKeyhole className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-foreground">Anti-Cheat</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${antiCheatTone(report.score)}`}
                >
                  {report.status}
                </span>
              </div>
              <p className="text-[13px] text-muted-foreground">
                Compatibilidade com anti-cheats modernos
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <SafetyBadge label="Leitura" />
            <SafetyBadge label="Seguro" />
            <SafetyBadge label="Sem alterações" />
          </div>
        </div>

        <div className="shrink-0 md:text-right">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Anti-Cheat Score
          </p>
          <p className="text-3xl font-bold leading-tight text-foreground">{report.score}/100</p>
        </div>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${report.score}%` }} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {checklist.map((check) => (
          <ChecklistItem key={check.label} check={check} />
        ))}
      </div>

      <div className="mt-5 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3">
        <p className="text-[10px] font-bold tracking-[0.18em] text-primary">NEXT Insight</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{report.summary}</p>
      </div>

      {report.warnings.length > 0 && (
        <div className="mt-3 rounded-xl border border-warning/20 bg-warning/10 px-4 py-3 text-[12px] text-warning">
          {report.warnings[0]}
        </div>
      )}

      {showActivationGuide && hasAnalyzed && (
        <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            Guia seguro
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            O NEXT mostra o caminho recomendado sem alterar BIOS, drivers, jogos ou configurações do
            Windows.
          </p>
          <div className="mt-3 space-y-2">
            {activationItems.length > 0 ? (
              activationItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-border/60 bg-card/65 px-3 py-2"
                >
                  <p className="text-[12px] font-bold text-foreground">{item.label}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{item.guidance}</p>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-300">
                Nenhuma funcao desativada foi detectada nesta leitura.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-5">
        {hasAnalyzed ? (
          <button
            type="button"
            onClick={runActivation}
            disabled={activation?.phase === "running" || activation?.phase === "restarting"}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/70 bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_0_22px_rgba(37,99,235,0.42),0_16px_32px_-18px_rgba(37,99,235,0.95)] transition hover:bg-primary/95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Shield className="h-4 w-4" />
            {showActivationGuide ? "Ocultar guia seguro" : "Ativar funções desativadas"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onAnalyze}
            disabled={isRunning}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_12px_26px_-18px_rgba(37,99,235,0.95)] transition hover:bg-primary/95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isRunning ? "animate-spin" : ""}`} />
            Analisar Anti-Cheat
          </button>
        )}
      </div>

      {activation && (
        <AntiCheatActivationModal
          activation={activation}
          onClose={() => setActivation(null)}
          onRestart={requestRestart}
        />
      )}
    </section>
  );
}

type ActivationUiState = {
  phase: "running" | "done" | "error" | "restarting";
  progress: number;
  title: string;
  message: string;
  result?: AntiCheatActivationResult;
  restart?: SystemRestartResult;
};

function AntiCheatActivationModal({
  activation,
  onClose,
  onRestart,
}: {
  activation: ActivationUiState;
  onClose: () => void;
  onRestart: () => void;
}) {
  const isBusy = activation.phase === "running" || activation.phase === "restarting";
  const canRestart =
    activation.phase === "done" &&
    Boolean(activation.result?.restartRequired) &&
    !activation.result?.dryRun;
  const canValidateRestart =
    activation.phase === "done" &&
    Boolean(activation.result?.restartRequired) &&
    Boolean(activation.result?.dryRun);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-primary/30 bg-card p-5 shadow-[0_24px_80px_-38px_rgba(168,85,247,0.9)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15">
              {isBusy ? (
                <RefreshCw className="h-6 w-6 animate-spin text-primary" />
              ) : (
                <Shield className="h-6 w-6 text-primary" />
              )}
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
                Anti-Cheat
              </p>
              <h3 className="text-lg font-bold text-foreground">{activation.title}</h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 rounded-2xl border border-border/70 bg-background/70 p-4">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            <span>Progresso</span>
            <span>{activation.progress}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${activation.progress}%` }}
            />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{activation.message}</p>
        </div>

        {activation.result?.actions.length ? (
          <div className="mt-4 grid gap-2">
            {activation.result.actions.map((action) => (
              <div
                key={action}
                className="rounded-xl border border-border/50 bg-background/45 px-3 py-2 text-xs font-semibold text-muted-foreground"
              >
                {action}
              </div>
            ))}
          </div>
        ) : null}

        {activation.result?.requiresAdmin && (
          <div className="mt-4 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-bold text-warning">
            Abra o NEXT como administrador para aplicar esta funcao.
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {(canRestart || canValidateRestart) && (
            <button
              type="button"
              onClick={onRestart}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary/95"
            >
              <Power className="h-4 w-4" />
              {canRestart ? "Reiniciar agora" : "Validar reinicio"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-border/70 px-4 text-sm font-bold text-foreground transition hover:bg-muted/40"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function ChecklistItem({ check }: { check: AntiCheatCheck }) {
  const iconClass = check.ok
    ? "text-emerald-500"
    : check.status === "Aguardando"
      ? "text-muted-foreground"
      : "text-warning";
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-3">
      <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} />
      <div className="min-w-0">
        <p className="truncate text-[12px] font-bold text-foreground">{check.label}</p>
        <p className="truncate text-[11px] text-muted-foreground">{check.status}</p>
      </div>
    </div>
  );
}

function SafetyBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
      {label}
    </span>
  );
}

function buildActivationItems(report: AntiCheatReport) {
  const checks = [
    {
      check: report.checks.tpm,
      guidance: "Verifique no BIOS/UEFI se TPM, Intel PTT ou AMD fTPM está ativo.",
    },
    {
      check: report.checks.secureBoot,
      guidance:
        "Confira o Secure Boot no BIOS/UEFI. Alguns jogos competitivos exigem esse recurso.",
    },
    {
      check: report.checks.coreIsolation,
      guidance: "Abra Segurança do Windows > Segurança do dispositivo > Isolamento do núcleo.",
    },
    {
      check: report.checks.driverSignature,
      guidance: "Prefira atualizar drivers pelo fabricante quando houver driver não assinado.",
    },
    {
      check: report.services.riotVanguard,
      guidance: "Abra o Riot Client ou Valorant e use o reparo oficial do Vanguard.",
    },
    {
      check: report.services.easyAntiCheat,
      guidance: "Abra o jogo ou launcher e utilize o reparo oficial do Easy Anti-Cheat.",
    },
    {
      check: report.services.faceit,
      guidance: "Abra o FACEIT Anti-Cheat oficial e confira se está instalado e ativo.",
    },
    {
      check: report.services.battleye,
      guidance: "Abra o jogo ou launcher e permita a inicialização oficial do BattlEye.",
    },
  ];

  return checks
    .filter(({ check }) => !check.ok && check.status !== "Aguardando")
    .map(({ check, guidance }) => ({ label: check.label, guidance }));
}

function antiCheatTone(score: number) {
  if (score >= 85)
    return "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20";
  if (score >= 60)
    return "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-400/20";
  if (score > 0)
    return "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20";
  return "bg-muted text-muted-foreground ring-border";
}
