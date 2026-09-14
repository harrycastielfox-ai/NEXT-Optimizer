import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Gamepad2,
  HardDrive,
  ListChecks,
  RotateCcw,
  ShieldCheck,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SafeTestModeNotice } from "@/components/common/SafeTestModeNotice";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { fallbackCleanScanReport, refreshCleanScanReport, type CleanScanReport } from "@/lib/clean";
import {
  fallbackDiagnosticReport,
  refreshDiagnosticReport,
  type DiagnosticReport,
} from "@/lib/diagnostic";
import { fallbackGamerReport, loadGamerReport, type GamerReport } from "@/lib/gamer";
import {
  fallbackPerformanceReport,
  refreshPerformanceReport,
  type PerformanceReport,
} from "@/lib/performance";
import { HERMES_SAFE_TEST_MODE } from "@/lib/safe-mode";
import { fallbackStartupReport, refreshStartupReport, type StartupReport } from "@/lib/startup";

type PrepStatus = "ready" | "attention" | "manual" | "safe" | "unavailable";

type EnvironmentReport = {
  diagnostic: DiagnosticReport;
  clean: CleanScanReport;
  startup: StartupReport;
  performance: PerformanceReport;
  gamer: GamerReport;
};

type PrepStep = {
  id: string;
  title: string;
  description: string;
  status: PrepStatus;
  risk: "baixo" | "médio" | "alto";
  time: string;
  cta: string;
  to: string;
  search?: Record<string, string>;
  icon: LucideIcon;
  bullets: string[];
};

export const Route = createFileRoute("/preparar-ambiente")({
  head: () => ({
    meta: [
      { title: "NEXT Optimizer - Preparar Ambiente" },
      {
        name: "description",
        content: "Fluxo guiado do NEXT para preparar o ambiente com poucos cliques.",
      },
    ],
  }),
  component: PrepararAmbientePage,
});

function PrepararAmbientePage() {
  const [report, setReport] = useState<EnvironmentReport>(() => fallbackEnvironmentReport());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validatedAt, setValidatedAt] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void validateEnvironment();
    }, 250);

    return () => window.clearTimeout(timer);
  }, []);

  const steps = useMemo(() => buildPrepSteps(report), [report]);
  const readyCount = steps.filter(
    (step) => step.status === "ready" || step.status === "safe",
  ).length;
  const attentionCount = steps.filter((step) => step.status === "attention").length;

  async function validateEnvironment() {
    setIsLoading(true);
    setError(null);

    try {
      const [diagnostic, clean, startup, performance, gamer] = await Promise.all([
        refreshDiagnosticReport(),
        refreshCleanScanReport(),
        refreshStartupReport(),
        refreshPerformanceReport(),
        loadGamerReport(),
      ]);

      setReport({ diagnostic, clean, startup, performance, gamer });
      setValidatedAt(
        new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="lightning-bg min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 overflow-auto px-5 pt-6 pb-5 xl:px-8 xl:pt-7">
          <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="mb-2 text-xs font-bold tracking-[0.22em] text-primary">
                PREPARAR AMBIENTE
              </p>
              <h1 className="text-[clamp(28px,2.4vw,38px)] font-bold leading-tight tracking-tight text-foreground">
                Menos de 4 cliques para resolver
              </h1>
              <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">
                O NEXT mistura diagnóstico, preparação, sessão Gamer e ferramentas sem esconder
                risco. Esta tela monta o caminho certo e leva cada ação para o modulo seguro.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void validateEnvironment()}
              disabled={isLoading}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground shadow-[0_12px_28px_-18px_rgba(37,99,235,0.9)] transition hover:bg-primary/95 disabled:opacity-60"
            >
              <ListChecks className="h-4 w-4" />
              {isLoading ? "Validando..." : "Validar ambiente"}
            </button>
          </div>

          <SafeTestModeNotice />

          <section className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <SummaryTile icon={Zap} label="Fluxo" value="4 cliques" sub="Regra oficial" />
            <SummaryTile
              icon={CheckCircle2}
              label="Prontos"
              value={`${readyCount}/${steps.length}`}
              sub="Sem alerta forte"
            />
            <SummaryTile
              icon={AlertTriangle}
              label="Atenção"
              value={`${attentionCount}`}
              sub="Revisar antes"
            />
            <SummaryTile
              icon={ShieldCheck}
              label="Modo"
              value={HERMES_SAFE_TEST_MODE ? "Dry-run" : "Real"}
              sub={validatedAt ? `Validado ${validatedAt}` : "Aguardando"}
            />
          </section>

          {error && (
            <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
              {error}
            </div>
          )}

          <section className="mt-4 rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_28px_-18px_rgba(15,23,42,0.18)]">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-sm font-bold tracking-[0.18em] text-primary">
                  CAMINHO RECOMENDADO
                </h2>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Inspirado no setup em fases, mas com transparencia, modulo certo e rollback do
                  NEXT.
                </p>
              </div>
              <span className="w-fit rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">
                Diagnóstico separado de alterações
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {steps.map((step, index) => (
                <PrepStepCard key={step.id} step={step} index={index + 1} />
              ))}
            </div>
          </section>

          <section className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
            <PrincipleCard
              icon={ShieldCheck}
              title="Sem surpresa"
              description="Analisar Agora continua somente leitura. Toda alteração vai para Perfil ou Ferramenta."
            />
            <PrincipleCard
              icon={RotateCcw}
              title="Voltar atras"
              description="Perfis e ferramentas precisam de snapshot, histórico ou rótulo claro de irreversível."
            />
            <PrincipleCard
              icon={Gamepad2}
              title="Sessão Gamer"
              description="O modo diario deve detectar o alvo, proteger apps importantes e permitir encerrar/restaurar."
            />
          </section>
        </main>
      </div>
    </div>
  );
}

function buildPrepSteps(report: EnvironmentReport): PrepStep[] {
  const hasDiagnostic = hasRealData(report.diagnostic.generatedAt);
  const cleanupGb = report.clean.totalGb;
  const startupItems = report.startup.totalItems;
  const gameDetected = report.gamer.summary.detectedGames > 0;

  return [
    {
      id: "diagnostic",
      title: "Analisar Agora",
      description: "Coleta completa, score, hardware e recomendações sem alterar o Windows.",
      status: hasDiagnostic ? "ready" : "unavailable",
      risk: "baixo",
      time: "1 clique",
      cta: "Voltar ao Dashboard",
      to: "/",
      icon: ListChecks,
      bullets: [
        hasDiagnostic ? "Diagnóstico real disponível" : "Aguardando backend Tauri",
        `Saúde atual: ${Math.round(report.diagnostic.healthScore)}/100`,
        "Sem limpeza, sem tweak, sem reboot",
      ],
    },
    {
      id: "environment",
      title: "Preparar Ambiente",
      description: "Agrupa reparo, componentes, limpeza e configurações pesadas em modulos claros.",
      status: "manual",
      risk: "alto",
      time: "2 a 10 min",
      cta: "Abrir Reparo",
      to: "/reparar-windows",
      icon: Wrench,
      bullets: [
        "Componentes, energia e rede ficam aqui",
        "SFC/DISM nunca rodam no diagnóstico rápido",
        "Pode exigir administrador e reinício",
      ],
    },
    {
      id: "cleanup-startup",
      title: "Limpeza e Inicialização",
      description: "Remove excesso com preview e reduz peso do boot sem apagar pastas pessoais.",
      status: cleanupGb > 0 || startupItems > 0 ? "attention" : "safe",
      risk: "médio",
      time: "até 3 cliques",
      cta: cleanupGb > 0 ? "Abrir Limpeza" : "Abrir Inicialização",
      to: cleanupGb > 0 ? "/limpeza" : "/inicializacao",
      icon: HardDrive,
      bullets: [
        `${formatGb(cleanupGb)} GB candidatos à revisão`,
        `${startupItems} item(ns) de inicialização`,
        "Downloads e documentos continuam protegidos",
      ],
    },
    {
      id: "gamer-session",
      title: "Sessão Gamer",
      description:
        "Modo diario: detectar jogo/app, proteger Discord/launcher e aplicar foco temporario.",
      status: gameDetected ? "ready" : "manual",
      risk: "médio",
      time: "2 cliques",
      cta: "Abrir Gamer",
      to: "/perfis",
      search: { perfil: "gamer" },
      icon: Gamepad2,
      bullets: [
        gameDetected
          ? `${report.gamer.summary.detectedGames} jogo(s) detectado(s)`
          : "Nenhum jogo aberto",
        `${report.gamer.summary.protectedCount} processo(s) protegido(s)`,
        "Encerrar e restaurar deve ser o fechamento da sessao",
      ],
    },
  ];
}

function PrepStepCard({ step, index }: { step: PrepStep; index: number }) {
  const Icon = step.icon;

  return (
    <article className="rounded-2xl border border-border/60 bg-background/70 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[10px] font-bold tracking-[0.16em] text-primary">PASSO {index}</p>
              <h3 className="mt-1 text-base font-bold text-foreground">{step.title}</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              <SmallPill text={statusLabel(step.status)} tone={step.status} />
              <SmallPill
                text={`Risco ${step.risk}`}
                tone={step.risk === "alto" ? "attention" : "safe"}
              />
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {step.bullets.map((bullet) => (
              <div
                key={bullet}
                className="rounded-xl border border-border/60 bg-card/80 px-3 py-2 text-[11px] font-medium text-foreground"
              >
                {bullet}
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold text-muted-foreground">{step.time}</span>
            <Link
              to={step.to}
              search={step.search}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-[12px] font-bold text-primary-foreground transition hover:bg-primary/95"
            >
              {step.cta}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

function SummaryTile({
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
    <div className="rounded-2xl border border-border/60 bg-card/90 px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
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

function PrincipleCard({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/90 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

function SmallPill({ text, tone }: { text: string; tone: PrepStatus | "safe" | "attention" }) {
  const className =
    tone === "attention" || tone === "manual"
      ? "border-warning/25 bg-warning/10 text-warning"
      : tone === "unavailable"
        ? "border-border bg-muted text-muted-foreground"
        : "border-success/20 bg-success/10 text-success";

  return (
    <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${className}`}>
      {text}
    </span>
  );
}

function statusLabel(status: PrepStatus) {
  if (status === "ready") return "Pronto";
  if (status === "attention") return "Revisar";
  if (status === "manual") return "Guiado";
  if (status === "safe") return "Ok";
  return "Indisponível";
}

function fallbackEnvironmentReport(): EnvironmentReport {
  return {
    diagnostic: fallbackDiagnosticReport,
    clean: fallbackCleanScanReport,
    startup: fallbackStartupReport,
    performance: fallbackPerformanceReport,
    gamer: fallbackGamerReport,
  };
}

function hasRealData(generatedAt: string) {
  return generatedAt !== "0" && generatedAt.trim().length > 0;
}

function formatGb(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}
