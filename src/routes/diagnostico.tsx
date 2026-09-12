import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Shield,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import {
  fallbackBenchmarkReport,
  loadCachedBenchmark,
  runBenchmark,
  type BenchmarkComponentScore,
  type BenchmarkReport,
} from "@/lib/benchmark";

export const Route = createFileRoute("/diagnostico")({
  head: () => ({
    meta: [
      { title: "NEXT Optimizer - Diagnóstico" },
      { name: "description", content: "Benchmark local leve do NEXT Optimizer." },
    ],
  }),
  component: DiagnosticoPage,
});

function DiagnosticoPage() {
  const [report, setReport] = useState<BenchmarkReport>(() =>
    withoutAntiCheatScore(fallbackBenchmarkReport),
  );
  const [isRunning, setIsRunning] = useState(false);

  const executeBenchmark = useCallback(async () => {
    if (isRunning) {
      return;
    }

    setIsRunning(true);
    try {
      const nextReport = await runBenchmark();
      setReport(withoutAntiCheatScore(nextReport));
    } finally {
      setIsRunning(false);
    }
  }, [isRunning]);

  useEffect(() => {
    let mounted = true;

    const timer = window.setTimeout(() => {
      void loadCachedBenchmark().then((cachedReport) => {
        if (mounted) {
          setReport(withoutAntiCheatScore(cachedReport));
        }
      });
    }, 80);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="lightning-bg min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 px-5 pt-6 pb-4 overflow-auto xl:px-8 xl:pt-7">
          <div className="mb-6 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-xs font-bold tracking-[0.22em] text-primary mb-2">
                BENCHMARK ENGINE
              </p>
              <h1 className="text-[clamp(26px,2vw,32px)] leading-tight font-bold tracking-tight text-foreground">
                Diagnóstico
              </h1>
              <p className="text-[13px] text-muted-foreground mt-1">
                Benchmark leve, local e somente leitura para comparar antes e depois das
                otimizações.
              </p>
            </div>
            <button
              className="inline-flex h-10 w-fit items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:bg-muted"
              disabled={isRunning}
              onClick={executeBenchmark}
            >
              <RefreshCw className={`h-4 w-4 text-primary ${isRunning ? "animate-spin" : ""}`} />
              Reexecutar benchmark
            </button>
          </div>

          <HermesAiDiagnosticPanel report={report} />

          <section className="mt-4 rounded-2xl bg-card border border-border/60 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold tracking-[0.18em] text-primary">
                    COMPONENTES DO SCORE
                  </h2>
                  <ScoreBadge score={report.score} />
                </div>
                <p className="text-[12px] text-muted-foreground mt-1">
                  Leitura rápida de estado. Não executa stress test e não altera o Windows.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <ComponentRow icon={Cpu} item={report.components.cpu} />
              <ComponentRow icon={MemoryStick} item={report.components.memory} />
              <ComponentRow icon={HardDrive} item={report.components.disk} />
              <ComponentRow icon={Zap} item={report.components.startup} />
              <ComponentRow icon={Gauge} item={report.components.power} />
              <ComponentRow icon={Shield} item={report.components.security} />
            </div>
          </section>

          <section className="mt-4 rounded-2xl bg-card border border-border/60 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
            <h2 className="text-sm font-bold tracking-[0.18em] text-primary">OBSERVACOES</h2>
            <div className="mt-3 space-y-2">
              {report.observations.map((observation) => (
                <p
                  key={observation}
                  className="rounded-xl bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
                >
                  {observation}
                </p>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function ComponentRow({ icon: Icon, item }: { icon: LucideIcon; item: BenchmarkComponentScore }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-soft flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{item.label}</p>
            <p className="text-[12px] text-muted-foreground truncate">{item.detail}</p>
          </div>
        </div>
        <p className="text-lg font-bold text-foreground">{item.score}</p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${item.score}%` }} />
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone = scoreTone(score);

  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold ring-1 ${tone}`}
    >
      <Gauge className="h-3.5 w-3.5" />
      {score}/100
    </span>
  );
}

function HermesAiDiagnosticPanel({ report }: { report: BenchmarkReport }) {
  const summary = buildHermesAiSummary(report);

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-blue-100/80 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_36px_-24px_rgba(37,99,235,0.28)]">
      <div className="relative p-5">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(37,99,235,0.10),transparent_30%),radial-gradient(circle_at_100%_15%,rgba(212,175,55,0.10),transparent_28%)]" />
        <div className="relative flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <BrainCircuit className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[10px] font-bold tracking-[0.22em] text-primary">NEXT Insight</p>
              <h2 className="mt-1 text-xl font-bold leading-tight text-foreground">
                Centro de Inteligencia NEXT
              </h2>
              <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
                Interpretacao local do benchmark. Nenhuma ação e aplicada e nenhum dado sai do
                computador.
              </p>
            </div>
          </div>

          <Link
            to="/otimizar"
            className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-white shadow-[0_14px_28px_-18px_rgba(37,99,235,0.95)] transition hover:bg-blue-700"
          >
            Ir para otimizar
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="relative mt-5 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
            <p className="text-[10px] font-bold tracking-wider text-muted-foreground">
              ESTADO GERAL
            </p>
            <div className="mt-2 flex items-end gap-2">
              <p className="text-4xl font-bold leading-none text-foreground">{report.score}</p>
              <p className="pb-1 text-sm font-semibold text-primary">{summary.stateLabel}</p>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{summary.stateText}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <InsightBlock title="Principais Gargalos" items={summary.bottlenecks} />
            <InsightBlock title="O que está bom" items={summary.strengths} positive />
          </div>
        </div>

        <div className="relative mt-3 grid gap-3 lg:grid-cols-[1fr_0.82fr]">
          <InsightBlock title="O que pode melhorar" items={summary.improvements} />
          <div className="rounded-2xl border border-blue-100 bg-blue-50/55 p-4 dark:border-primary/25 dark:bg-primary/10">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-primary dark:bg-primary/15">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-bold tracking-wider text-primary">
                  PROXIMA ACAO RECOMENDADA
                </p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {summary.recommendedAction}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function InsightBlock({
  title,
  items,
  positive,
}: {
  title: string;
  items: string[];
  positive?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <p className="text-[10px] font-bold tracking-wider text-muted-foreground">
        {title.toUpperCase()}
      </p>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div key={item} className="flex gap-2 text-sm text-muted-foreground">
            <CheckCircle2
              className={`mt-0.5 h-4 w-4 shrink-0 ${positive ? "text-emerald-500" : "text-primary"}`}
            />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildHermesAiSummary(report: BenchmarkReport) {
  const components = [
    report.components.cpu,
    report.components.memory,
    report.components.disk,
    report.components.startup,
    report.components.power,
    report.components.security,
  ];

  const weakest = [...components].sort((a, b) => a.score - b.score);
  const bottlenecks = weakest
    .filter((component) => component.score < 78)
    .slice(0, 3)
    .map((component) => `${component.label}: ${component.detail}`);

  const strengths = [...components]
    .sort((a, b) => b.score - a.score)
    .filter((component) => component.score >= 82)
    .slice(0, 3)
    .map((component) => `${component.label} está dentro de um bom intervalo.`);

  const improvements = [
    report.components.startup.score < 82
      ? "Revisar itens de inicialização para reduzir impacto no boot."
      : null,
    report.components.power.score < 82
      ? "Revisar configurações de energia para alinhar desempenho e estabilidade."
      : null,
    report.components.disk.score < 82
      ? "Executar um scan de limpeza segura antes de qualquer remocao."
      : null,
    report.components.memory.score < 75
      ? "Verificar apps em segundo plano usando muita memoria."
      : null,
  ].filter(Boolean) as string[];

  if (bottlenecks.length === 0) {
    bottlenecks.push("Nenhum gargalo relevante foi detectado pelo benchmark atual.");
  }

  if (strengths.length === 0) {
    strengths.push(
      "O sistema está operacional, mas ainda não há um componente claramente excelente.",
    );
  }

  if (improvements.length === 0) {
    improvements.push(
      "Manter diagnosticos periodicos e comparar o score antes e depois das otimizações.",
    );
  }

  return {
    stateLabel: stateLabel(report.score),
    stateText: stateText(report.score),
    bottlenecks,
    strengths,
    improvements,
    recommendedAction: recommendedAction(report),
  };
}

function stateLabel(score: number) {
  if (score >= 90) return "Excelente";
  if (score >= 80) return "Saudavel";
  if (score >= 65) return "Pode melhorar";
  return "Atencao";
}

function stateText(score: number) {
  if (score >= 90) return "Seu sistema apresenta bom estado geral e não exige ajustes agressivos.";
  if (score >= 80) return "Seu sistema está saudável, com oportunidades pontuais de melhoria.";
  if (score >= 65) return "O NEXT encontrou pontos que podem ser otimizados com segurança.";
  return "O benchmark indica que vale revisar desempenho, inicialização e limpeza com cuidado.";
}

function recommendedAction(report: BenchmarkReport) {
  if (report.components.startup.score < 75) {
    return "Revisar inicialização antes de aplicar qualquer perfil.";
  }

  if (report.components.disk.score < 75) {
    return "Executar limpeza segura em modo de validação.";
  }

  if (report.components.power.score < 78) {
    return "Revisar configurações de desempenho em Otimizações.";
  }

  return "Abrir Otimizações Recomendadas para validar o melhor próximo passo.";
}

function withoutAntiCheatScore(report: BenchmarkReport): BenchmarkReport {
  const diagnosticComponents = [
    report.components.cpu,
    report.components.memory,
    report.components.disk,
    report.components.startup,
    report.components.power,
    report.components.security,
  ];
  return {
    ...report,
    score: weightedScore(diagnosticComponents),
  };
}

function weightedScore(components: BenchmarkComponentScore[]) {
  const weightTotal = components.reduce((sum, component) => sum + component.weight, 0);
  if (weightTotal <= 0) {
    return 0;
  }
  return Math.round(
    components.reduce((sum, component) => sum + component.score * component.weight, 0) /
      weightTotal,
  );
}

function scoreTone(score: number) {
  if (score >= 100) {
    return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  }

  if (score >= 70) {
    return "bg-blue-50 text-blue-700 ring-blue-100";
  }

  if (score >= 40) {
    return "bg-amber-50 text-amber-700 ring-amber-100";
  }

  return "bg-red-50 text-red-700 ring-red-100";
}
