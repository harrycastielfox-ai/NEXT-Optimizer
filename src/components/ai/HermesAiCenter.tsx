import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  CircleGauge,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  Info,
  Layers3,
  ListChecks,
  Loader2,
  LockKeyhole,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  loadAdvisorAiReport,
  refreshAdvisorAiReport,
  type AdvisorAiCategory,
  type AdvisorAiConfidence,
  type AdvisorAiFinding,
  type AdvisorAiRecommendation,
  type AdvisorAiReport,
  type AdvisorAiSeverity,
  type AdvisorAiSource,
  unavailableAdvisorAiReport,
} from "@/lib/advisor-ai";

export function HermesAiCenter() {
  const [report, setReport] = useState<AdvisorAiReport>(unavailableAdvisorAiReport);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadReport(false);
  }, []);

  async function loadReport(force = true) {
    setIsLoading(true);
    setError(null);

    try {
      const nextReport = force ? await refreshAdvisorAiReport() : await loadAdvisorAiReport();
      setReport(nextReport);
    } catch (nextError) {
      setError(errorMessage(nextError));
      setReport(unavailableAdvisorAiReport);
    } finally {
      setIsLoading(false);
    }
  }

  const classification = classifyScore(report);
  const actionPlan = useMemo(() => buildActionPlan(report), [report]);
  const topFindings = report.findings.slice(0, 5);
  const topRecommendations = report.recommendations.slice(0, 5);

  return (
    <section
      id="hermes-ai"
      className="relative scroll-mt-5 mt-5 overflow-hidden rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_34px_-20px_rgba(15,23,42,0.16)]"
    >
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute right-[-60px] top-[-70px] h-52 w-52 rounded-full bg-primary/8 blur-3xl" />
        <div className="absolute bottom-10 left-1/4 h-px w-80 rotate-[112deg] bg-gradient-to-r from-transparent via-primary/16 to-transparent" />
        <div className="absolute right-28 top-16 h-px w-72 rotate-[145deg] bg-gradient-to-r from-transparent via-amber-300/40 to-transparent" />
      </div>

      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary shadow-[0_12px_30px_-22px_rgba(37,99,235,0.85)]">
            <BrainCircuit className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-[0.22em] text-primary">NEXT Insight</p>
            <h2 className="mt-1 text-lg font-bold text-foreground">Centro de Inteligencia NEXT</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Análise local, offline e somente leitura. A NEXT Insight explica gargalos e recomenda
              proximos passos, sem aplicar nada automaticamente.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => loadReport(true)}
          disabled={isLoading}
          className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:bg-muted disabled:opacity-60"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <RefreshCcw className="h-4 w-4 text-primary" />
          )}
          Atualizar analise
        </button>
      </div>

      {error && (
        <div className="relative mt-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
          {error}
        </div>
      )}

      <div className="relative mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <ScoreRing value={report.hermesScore.value} tone={classification.tone} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold tracking-[0.18em] text-primary">ESTADO GERAL</p>
              <h3 className="mt-1 text-2xl font-bold leading-tight text-foreground">
                {classification.label}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {report.summary.generalState}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Pill
                  icon={ShieldCheck}
                  label={report.offline ? "Offline" : "Online"}
                  tone="success"
                />
                <Pill
                  icon={LockKeyhole}
                  label={report.readOnly ? "Read-only" : "Pode alterar"}
                  tone={report.readOnly ? "success" : "warning"}
                />
                <Pill
                  icon={Gauge}
                  label={`Confianca ${confidenceLabel(report.summary.confidence)}`}
                  tone={confidenceTone(report.summary.confidence)}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <MiniMetric label="Problemas" value={`${report.summary.problemCount}`} />
            <MiniMetric label="Recomendações" value={`${report.summary.recommendationCount}`} />
            <MiniMetric
              label="Cobertura"
              value={`${Math.round(report.hermesScore.coveragePercent)}%`}
            />
          </div>

          <div className="mt-4 rounded-xl border border-border/70 bg-card px-3 py-3">
            <p className="text-[11px] font-bold tracking-[0.16em] text-primary">
              PERFIL RECOMENDADO
            </p>
            <p className="mt-1 text-lg font-bold text-foreground">
              {report.summary.recommendedProfile ?? "Indisponível"}
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {report.summary.recommendedProfileReason}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <InsightPanel
            title="Problemas Detectados"
            emptyTitle="Nenhum problema crítico"
            emptySub="A NEXT Insight não detectou gargalos com as fontes atuais."
            items={topFindings}
            renderItem={(item) => <FindingRow key={item.id} item={item} sources={report.sources} />}
          />
          <InsightPanel
            title="Recomendações"
            emptyTitle="Sem recomendações agora"
            emptySub="Quando houver sinais suficientes, as recomendações aparecem aqui."
            items={topRecommendations}
            renderItem={(item) => (
              <RecommendationRow key={item.id} item={item} sources={report.sources} />
            )}
          />
        </div>
      </div>

      <div className="relative mt-4 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
        <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-[12px] font-bold tracking-[0.18em] text-primary">
                PLANO DE AÇÃO NEXT
              </h3>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Recomendação textual. Nenhuma etapa e executada automaticamente.
              </p>
            </div>
            <span className="w-fit rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[10px] font-bold text-primary">
              Somente recomendação
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {actionPlan.map((item, index) => (
              <ActionPlanRow key={`${item}-${index}`} index={index + 1} text={item} />
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
          <h3 className="text-[12px] font-bold tracking-[0.18em] text-primary">
            FONTES UTILIZADAS
          </h3>
          <div className="mt-3 space-y-2">
            {report.sources.length > 0 ? (
              report.sources.map((source) => <SourceRow key={source.id} source={source} />)
            ) : (
              <EmptyState
                icon={Database}
                title="Fontes indisponíveis"
                sub={report.unavailableData[0] ?? "Sem fontes reais disponíveis nesta execução."}
              />
            )}
          </div>
        </div>
      </div>

      <div className="relative mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
          <h3 className="text-[12px] font-bold tracking-[0.18em] text-primary">
            COMPONENTES DO SCORE
          </h3>
          <div className="mt-3 space-y-2">
            {report.hermesScore.components.length > 0 ? (
              report.hermesScore.components.map((component) => (
                <ScoreComponentRow
                  key={component.id}
                  label={component.label}
                  value={component.value}
                  explanation={component.explanation}
                />
              ))
            ) : (
              <EmptyState
                icon={CircleGauge}
                title="Score indisponível"
                sub={report.hermesScore.explanation}
              />
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
          <h3 className="text-[12px] font-bold tracking-[0.18em] text-primary">TRANSPARENCIA</h3>
          <div className="mt-3 space-y-2">
            {report.safeguards.map((item) => (
              <div
                key={item}
                className="flex items-start gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 text-sm text-foreground"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>{item}</span>
              </div>
            ))}
            {report.unavailableData.map((item) => (
              <div
                key={item}
                className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ScoreRing({
  value,
  tone,
}: {
  value: number | null;
  tone: "success" | "primary" | "warning" | "danger";
}) {
  const normalized = value == null ? 0 : Math.max(0, Math.min(100, value));
  const circle = 2 * Math.PI * 44;
  const offset = circle - (circle * normalized) / 100;
  const colorClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-destructive"
          : "text-primary";

  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 104 104" className="h-full w-full rotate-[-90deg]">
        <circle cx="52" cy="52" r="44" className="fill-none stroke-slate-100" strokeWidth="10" />
        <circle
          cx="52"
          cy="52"
          r="44"
          className={`fill-none ${colorClass}`}
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circle}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-3xl font-bold leading-none text-foreground">
          {value == null ? "--" : Math.round(value)}
        </p>
        <p className="text-[11px] font-bold text-muted-foreground">/100</p>
      </div>
    </div>
  );
}

function InsightPanel<T>({
  title,
  emptyTitle,
  emptySub,
  items,
  renderItem,
}: {
  title: string;
  emptyTitle: string;
  emptySub: string;
  items: T[];
  renderItem: (item: T) => ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <h3 className="text-[12px] font-bold tracking-[0.18em] text-primary">{title}</h3>
      <div className="mt-3 space-y-2">
        {items.length > 0 ? (
          items.map(renderItem)
        ) : (
          <EmptyState icon={Sparkles} title={emptyTitle} sub={emptySub} />
        )}
      </div>
    </div>
  );
}

function FindingRow({ item, sources }: { item: AdvisorAiFinding; sources: AdvisorAiSource[] }) {
  const Icon = categoryIcon(item.category);

  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-3">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${severityIconClass(item.severity)}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-foreground">{item.title}</p>
            <SeverityPill severity={item.severity} />
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {item.explanation}
          </p>
          <p className="mt-2 text-[12px] font-semibold text-foreground">{item.impactEstimate}</p>
          <SourceChips ids={item.sourceIds} sources={sources} />
        </div>
      </div>
    </div>
  );
}

function RecommendationRow({
  item,
  sources,
}: {
  item: AdvisorAiRecommendation;
  sources: AdvisorAiSource[];
}) {
  const Icon = categoryIcon(item.category);

  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-3">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${severityIconClass(item.severity)}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-foreground">{item.title}</p>
            <SeverityPill severity={item.severity} />
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {item.description}
          </p>
          {item.suggestedProfile && (
            <p className="mt-2 text-[12px] font-semibold text-primary">
              Perfil sugerido: {item.suggestedProfile}
            </p>
          )}
          <SourceChips ids={item.sourceIds} sources={sources} />
        </div>
      </div>
    </div>
  );
}

function SourceRow({ source }: { source: AdvisorAiSource }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SourceStatusIcon status={source.status} />
            <p className="text-sm font-bold text-foreground">{source.label}</p>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{source.detail}</p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${confidenceClass(source.confidence)}`}
        >
          {confidenceLabel(source.confidence)}
        </span>
      </div>
      {source.warnings.length > 0 && (
        <p className="mt-2 text-[11px] font-semibold text-warning">{source.warnings[0]}</p>
      )}
    </div>
  );
}

function SourceStatusIcon({ status }: { status: AdvisorAiSource["status"] }) {
  if (status === "available") {
    return <CheckCircle2 className="h-4 w-4 text-success" />;
  }

  if (status === "partial") {
    return <AlertTriangle className="h-4 w-4 text-warning" />;
  }

  return <Info className="h-4 w-4 text-muted-foreground" />;
}

function ScoreComponentRow({
  label,
  value,
  explanation,
}: {
  label: string;
  value: number | null;
  explanation: string;
}) {
  const safeValue = value == null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-foreground">{label}</p>
        <p className="text-sm font-bold text-primary">{value == null ? "--" : Math.round(value)}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-sky-400"
          style={{ width: `${safeValue}%` }}
        />
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{explanation}</p>
    </div>
  );
}

function ActionPlanRow({ index, text }: { index: number; text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card px-3 py-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
        {index}
      </div>
      <p className="text-sm font-semibold leading-relaxed text-foreground">{text}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-3">
      <p className="text-[10px] font-bold tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function Pill({
  icon: Icon,
  label,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  tone: "success" | "warning" | "primary";
}) {
  const className =
    tone === "success"
      ? "bg-success/10 text-success border-success/20"
      : tone === "warning"
        ? "bg-warning/10 text-warning border-warning/25"
        : "bg-primary/10 text-primary border-primary/20";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${className}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function SeverityPill({ severity }: { severity: AdvisorAiSeverity }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${severityPillClass(severity)}`}
    >
      {severityLabel(severity)}
    </span>
  );
}

function SourceChips({ ids, sources }: { ids: string[]; sources: AdvisorAiSource[] }) {
  const labels = ids
    .map((id) => sources.find((source) => source.id === id)?.label ?? id)
    .slice(0, 3);

  if (labels.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <span
          key={label}
          className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-bold text-muted-foreground"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/70 px-4 py-5 text-center">
      <Icon className="mx-auto h-6 w-6 text-muted-foreground" />
      <p className="mt-2 text-sm font-bold text-foreground">{title}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function classifyScore(report: AdvisorAiReport): {
  label: string;
  tone: "success" | "primary" | "warning" | "danger";
} {
  const score = report.hermesScore.value;

  if (score == null) {
    return { label: "Indisponível", tone: "warning" };
  }

  if (score >= 90) {
    return { label: "Excelente", tone: "success" };
  }

  if (score >= 75) {
    return { label: "Saudavel", tone: "primary" };
  }

  if (score >= 55) {
    return { label: "Necessita Otimização", tone: "warning" };
  }

  if (score >= 35) {
    return { label: "Atencao", tone: "warning" };
  }

  return { label: "Crítico", tone: "danger" };
}

function buildActionPlan(report: AdvisorAiReport): string[] {
  const plan: string[] = [];
  const categories = new Set(report.recommendations.map((item) => item.category));

  if (categories.has("cleanup")) {
    plan.push("Executar limpeza segura após revisar os itens encontrados.");
  }
  if (categories.has("startup")) {
    plan.push("Revisar inicialização e desativar apenas itens aprovados pelo usuário.");
  }
  if (report.summary.recommendedProfile) {
    plan.push(`Avaliar o Perfil ${report.summary.recommendedProfile} antes de aplicar ajustes.`);
  }
  if (categories.has("benchmark")) {
    plan.push("Executar benchmark novamente para comparar antes e depois.");
  }
  if (categories.has("performance") || categories.has("gamer")) {
    plan.push("Validar Performance Engine e Game Mode antes de aplicar ajustes.");
  }

  plan.push("Abrir a área Otimizar para seguir o plano guiado com menos cliques.");

  return Array.from(new Set(plan)).slice(0, 6);
}

function categoryIcon(category: AdvisorAiCategory): LucideIcon {
  if (category === "startup") return Zap;
  if (category === "cleanup") return Sparkles;
  if (category === "benchmark") return Gauge;
  if (category === "memory") return Cpu;
  if (category === "disk") return HardDrive;
  if (category === "performance") return CircleGauge;
  if (category === "security" || category === "restore") return ShieldCheck;
  if (category === "profile") return Layers3;
  return BrainCircuit;
}

function severityIconClass(severity: AdvisorAiSeverity) {
  if (severity === "critical" || severity === "high") {
    return "bg-destructive/10 text-destructive";
  }
  if (severity === "medium") {
    return "bg-warning/10 text-warning";
  }
  if (severity === "low") {
    return "bg-primary/10 text-primary";
  }
  return "bg-muted text-muted-foreground";
}

function severityPillClass(severity: AdvisorAiSeverity) {
  if (severity === "critical" || severity === "high") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }
  if (severity === "medium") {
    return "border-warning/25 bg-warning/10 text-warning";
  }
  if (severity === "low") {
    return "border-primary/20 bg-primary/10 text-primary";
  }
  return "border-border bg-muted text-muted-foreground";
}

function severityLabel(severity: AdvisorAiSeverity) {
  if (severity === "critical") return "Crítico";
  if (severity === "high") return "Alto";
  if (severity === "medium") return "Médio";
  if (severity === "low") return "Baixo";
  return "Info";
}

function confidenceLabel(confidence: AdvisorAiConfidence) {
  if (confidence === "high") return "alta";
  if (confidence === "medium") return "media";
  return "baixa";
}

function confidenceTone(confidence: AdvisorAiConfidence): "success" | "warning" | "primary" {
  if (confidence === "high") return "success";
  if (confidence === "medium") return "primary";
  return "warning";
}

function confidenceClass(confidence: AdvisorAiConfidence) {
  if (confidence === "high") return "border-success/20 bg-success/10 text-success";
  if (confidence === "medium") return "border-primary/20 bg-primary/10 text-primary";
  return "border-warning/25 bg-warning/10 text-warning";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
