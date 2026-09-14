import { createFileRoute } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  Battery,
  BriefcaseBusiness,
  CheckCircle2,
  Flame,
  Gamepad2,
  RotateCcw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SafeTestModeNotice } from "@/components/common/SafeTestModeNotice";
import { Sidebar } from "@/components/dashboard/Sidebar";
import {
  applyGamerEngine,
  fallbackGamerReport,
  loadGamerReport,
  type GamerApplyResult,
  type GamerProcess,
  type GamerRecommendation,
  type GamerReport,
} from "@/lib/gamer";
import {
  applyHermesProfile,
  fallbackProfilesCatalog,
  loadProfilesCatalog,
  type HermesProfile,
  type ProfileApplyResult,
  type ProfileRisk,
  type ProfilesCatalog,
} from "@/lib/profiles";
import { HERMES_SAFE_TEST_MODE } from "@/lib/safe-mode";

export const Route = createFileRoute("/perfis")({
  validateSearch: (search: Record<string, unknown>) => ({
    perfil: typeof search.perfil === "string" ? search.perfil : undefined,
  }),
  head: () => ({
    meta: [
      { title: "NEXT Optimizer - Perfis" },
      { name: "description", content: "Perfis locais do NEXT Optimizer." },
    ],
  }),
  component: PerfisPage,
});

function PerfisPage() {
  const { perfil } = Route.useSearch();
  const [catalog, setCatalog] = useState<ProfilesCatalog>(fallbackProfilesCatalog);
  const [selectedId, setSelectedId] = useState("seguro");
  const [result, setResult] = useState<ProfileApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [gamerReport, setGamerReport] = useState<GamerReport>(fallbackGamerReport);
  const [gamerResult, setGamerResult] = useState<GamerApplyResult | null>(null);
  const [gamerError, setGamerError] = useState<string | null>(null);
  const [isGamerApplying, setIsGamerApplying] = useState(false);

  useEffect(() => {
    let mounted = true;

    loadProfilesCatalog().then((nextCatalog) => {
      if (mounted) {
        setCatalog(nextCatalog);
        setSelectedId((current) =>
          nextCatalog.profiles.some((profile) => profile.id === current)
            ? current
            : (nextCatalog.profiles[0]?.id ?? "seguro"),
        );
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (perfil) {
      setSelectedId(perfil);
    }
  }, [perfil]);

  useEffect(() => {
    if (selectedId !== "gamer" && selectedId !== "extremo") {
      return;
    }

    let mounted = true;
    const timer = window.setTimeout(() => {
      loadGamerReport().then((nextReport) => {
        if (mounted) {
          setGamerReport(nextReport);
        }
      });
    }, 350);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [selectedId]);

  const selectedProfile = useMemo(
    () => catalog.profiles.find((profile) => profile.id === selectedId) ?? catalog.profiles[0],
    [catalog.profiles, selectedId],
  );

  async function runProfile(profile: HermesProfile, dryRun: boolean) {
    setError(null);
    setResult(null);

    if (!dryRun && !HERMES_SAFE_TEST_MODE) {
      const confirmed = window.confirm(
        `Aplicar o perfil ${profile.name}? Um ponto de segurança será criado antes.`,
      );
      if (!confirmed) {
        return;
      }

      if (profile.requiresExtraConfirmation) {
        const extremeConfirmed = window.confirm(
          "Perfil Extremo exige confirmação extra. Continuar?",
        );
        if (!extremeConfirmed) {
          return;
        }
      }
    }

    setIsApplying(true);
    try {
      const nextResult = await applyHermesProfile({
        profileId: profile.id,
        confirmed: !dryRun && !HERMES_SAFE_TEST_MODE,
        dryRun: dryRun || HERMES_SAFE_TEST_MODE,
        extremeConfirmed: !dryRun && !HERMES_SAFE_TEST_MODE && profile.requiresExtraConfirmation,
      });
      setResult(nextResult);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsApplying(false);
    }
  }

  async function runGamerEngine(dryRun: boolean) {
    setGamerError(null);
    setGamerResult(null);

    const selectedProcesses = gamerReport.suggestedProcesses
      .filter(
        (process) =>
          process.canClose &&
          process.rollbackAvailable &&
          process.recommendation === "suggestedClose",
      )
      .map((process) => process.pid);

    if (!dryRun && !HERMES_SAFE_TEST_MODE) {
      const confirmed = window.confirm(
        "Ativar Modo Gamer NEXT? Um ponto de segurança será criado antes e os apps sugeridos serão fechados de forma graciosa.",
      );
      if (!confirmed) {
        return;
      }
    }

    setIsGamerApplying(true);
    try {
      const nextResult = await applyGamerEngine({
        confirmed: !dryRun && !HERMES_SAFE_TEST_MODE,
        dryRun: dryRun || HERMES_SAFE_TEST_MODE,
        processIds: selectedProcesses,
        includePerformanceProfile: true,
      });
      setGamerResult(nextResult);
      const nextReport = await loadGamerReport();
      setGamerReport(nextReport);
    } catch (nextError) {
      setGamerError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsGamerApplying(false);
    }
  }

  return (
    <div className="lightning-bg min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 px-5 pt-6 pb-4 overflow-auto xl:px-8 xl:pt-7">
          <div className="mb-6">
            <p className="text-xs font-bold tracking-[0.22em] text-primary mb-2">PERFIS NEXT</p>
            <h1 className="text-[clamp(26px,2vw,32px)] leading-tight font-bold tracking-tight text-foreground">
              Perfis
            </h1>
            <p className="text-[13px] text-muted-foreground mt-1">
              Perfis locais com ponto de segurança, histórico e reversão antes de ajustes reais.
            </p>
          </div>

          <SafeTestModeNotice />

          <div className="grid grid-cols-1 gap-3 mb-4 lg:grid-cols-5">
            {catalog.profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                selected={profile.id === selectedProfile?.id}
                onSelect={() => setSelectedId(profile.id)}
              />
            ))}
          </div>

          {selectedProfile && (
            <section className="rounded-2xl bg-card border border-border/60 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-primary-soft flex items-center justify-center shrink-0">
                    <SelectedIcon profileId={selectedProfile.id} className="w-7 h-7 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-bold text-foreground">{selectedProfile.name}</h2>
                      <span
                        className={`rounded-full border px-3 py-1 text-[11px] font-bold ${riskVisual(selectedProfile.risk)}`}
                      >
                        {riskLabel(selectedProfile.risk)}
                      </span>
                      {selectedProfile.reversible && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success/10 px-3 py-1 text-[11px] font-bold text-success">
                          <RotateCcw className="w-3.5 h-3.5" />
                          Reversível
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{selectedProfile.summary}</p>
                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {selectedProfile.expectedImpact.map((item) => (
                        <InfoPill key={item} icon={Zap} text={item} />
                      ))}
                      {selectedProfile.safeguards.slice(0, 2).map((item) => (
                        <InfoPill key={item} icon={ShieldCheck} text={item} />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
                  <button
                    type="button"
                    disabled={isApplying}
                    onClick={() => runProfile(selectedProfile, true)}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Validar perfil
                  </button>
                  <button
                    type="button"
                    disabled={isApplying}
                    onClick={() => runProfile(selectedProfile, false)}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_10px_26px_-14px_rgba(37,99,235,0.85)] transition hover:bg-primary/95 disabled:opacity-60"
                  >
                    <Zap className="w-4 h-4" />
                    {HERMES_SAFE_TEST_MODE ? "Validar seguro" : "Aplicar perfil"}
                  </button>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <DetailBox
                  title="ACOES DO PERFIL"
                  items={selectedProfile.performanceActionIds.map(actionLabel)}
                />
                <DetailBox title="GARANTIAS" items={selectedProfile.safeguards} />
              </div>

              {result && (
                <div className="mt-4 rounded-xl border border-success/20 bg-success/10 px-4 py-3">
                  <p className="text-sm font-semibold text-success">
                    {result.dryRun ? "Dry-run concluído" : "Perfil aplicado"}
                  </p>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Ponto de segurança: {result.snapshotId}. {result.message}
                  </p>
                </div>
              )}

              {error && (
                <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
                  {error}
                </div>
              )}
            </section>
          )}

          {selectedProfile &&
            (selectedProfile.id === "gamer" || selectedProfile.id === "extremo") && (
              <GamerEnginePanel
                report={gamerReport}
                result={gamerResult}
                error={gamerError}
                isApplying={isGamerApplying}
                onRun={runGamerEngine}
              />
            )}
        </main>
      </div>
    </div>
  );
}

function GamerEnginePanel({
  report,
  result,
  error,
  isApplying,
  onRun,
}: {
  report: GamerReport;
  result: GamerApplyResult | null;
  error: string | null;
  isApplying: boolean;
  onRun: (dryRun: boolean) => void;
}) {
  const suggested = report.suggestedProcesses.slice(0, 6);

  return (
    <section className="mt-4 rounded-2xl bg-card border border-border/60 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-sm font-bold tracking-[0.18em] text-primary">MODO GAMER NEXT</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Analisa jogos, sobreposicoes e apps em segundo plano. Fechamento real sempre exige
            confirmação.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={isApplying}
            onClick={() => onRun(true)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-60"
          >
            <CheckCircle2 className="w-4 h-4" />
            Validar modo
          </button>
          <button
            type="button"
            disabled={isApplying}
            onClick={() => onRun(false)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_10px_26px_-14px_rgba(37,99,235,0.85)] transition hover:bg-primary/95 disabled:opacity-60"
          >
            <Gamepad2 className="w-4 h-4" />
            {HERMES_SAFE_TEST_MODE ? "Validar seguro" : "Ativar modo"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
        <GamerMetric
          label="JOGOS"
          value={`${report.summary.detectedGames}`}
          sub="Detectados agora"
        />
        <GamerMetric
          label="SUGERIDOS"
          value={`${report.summary.suggestedToClose}`}
          sub="Apps avaliados"
        />
        <GamerMetric
          label="RAM"
          value={`${report.summary.estimatedRamToFreeMb} MB`}
          sub="Potencial liberavel"
        />
        <GamerMetric
          label="PROTEGIDOS"
          value={`${report.summary.protectedCount}`}
          sub="Nunca fechados"
        />
      </div>

      <div className="mt-4 rounded-xl border border-border/70 bg-background/70 px-4 py-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-[11px] font-bold tracking-[0.18em] text-primary">APPS SUGERIDOS</h3>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Somente apps com reversão disponível entram na aplicação automática.
            </p>
          </div>
          <span className="w-fit rounded-full border border-success/20 bg-success/10 px-3 py-1 text-[11px] font-bold text-success">
            Sem fechamento forcado
          </span>
        </div>

        <div className="mt-3 space-y-2">
          {suggested.length > 0 ? (
            suggested.map((process) => (
              <GamerProcessRow key={`${process.pid}-${process.name}`} process={process} />
            ))
          ) : (
            <p className="rounded-xl border border-border/70 bg-card px-3 py-3 text-sm text-muted-foreground">
              Nenhum app não essencial sugerido para fechar agora.
            </p>
          )}
        </div>
      </div>

      {result && (
        <div className="mt-4 rounded-xl border border-success/20 bg-success/10 px-4 py-3">
          <p className="text-sm font-semibold text-success">
            {result.dryRun ? "Validação gamer concluída" : "Modo Gamer aplicado"}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Ponto de segurança: {result.snapshotId}. {result.message}
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
          {error}
        </div>
      )}
    </section>
  );
}

function GamerMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-3">
      <p className="text-[10px] font-bold tracking-wider text-muted-foreground">{label}</p>
      <p className="text-xl font-bold text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function GamerProcessRow({ process }: { process: GamerProcess }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-foreground">{process.displayName}</p>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${recommendationVisual(process.recommendation)}`}
          >
            {recommendationLabel(process.recommendation)}
          </span>
        </div>
        <p className="mt-1 truncate text-[12px] text-muted-foreground">{process.reason}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-sm font-semibold text-primary">
        <Zap className="w-4 h-4" />
        {process.memoryMb} MB
      </div>
    </div>
  );
}

function ProfileCard({
  profile,
  selected,
  onSelect,
}: {
  profile: HermesProfile;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = profileIcon(profile.id);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded-2xl border p-4 text-left transition shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)] ${
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border/60 bg-card hover:border-primary/35"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-11 h-11 rounded-xl flex items-center justify-center ${selected ? "bg-primary text-primary-foreground" : "bg-primary-soft text-primary"}`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">{profile.name}</p>
          <p className="text-[11px] text-muted-foreground truncate">{riskLabel(profile.risk)}</p>
        </div>
      </div>
      <p className="mt-3 min-h-[34px] text-[12px] leading-relaxed text-muted-foreground">
        {profile.summary}
      </p>
    </button>
  );
}

function DetailBox({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-3">
      <h3 className="text-[11px] font-bold tracking-[0.18em] text-primary">{title}</h3>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div key={item} className="flex items-center gap-2 text-sm text-foreground">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-primary" />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InfoPill({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-3 text-[12px] font-semibold text-foreground">
      <Icon className="w-4 h-4 shrink-0 text-primary" />
      <span className="leading-tight">{text}</span>
    </div>
  );
}

function SelectedIcon({ profileId, className }: { profileId: string; className: string }) {
  const Icon = profileIcon(profileId);
  return <Icon className={className} />;
}

function profileIcon(profileId: string): LucideIcon {
  if (profileId === "trabalho") {
    return BriefcaseBusiness;
  }

  if (profileId === "gamer") {
    return Gamepad2;
  }

  if (profileId === "economia") {
    return Battery;
  }

  if (profileId === "extremo") {
    return Flame;
  }

  return ShieldCheck;
}

function riskLabel(risk: ProfileRisk) {
  if (risk === "high") {
    return "Alto";
  }

  if (risk === "medium") {
    return "Médio";
  }

  return "Baixo";
}

function riskVisual(risk: ProfileRisk) {
  if (risk === "high") {
    return "bg-destructive/10 text-destructive border-destructive/20";
  }

  if (risk === "medium") {
    return "bg-warning/15 text-warning border-warning/25";
  }

  return "bg-success/15 text-success border-success/25";
}

function recommendationLabel(recommendation: GamerRecommendation) {
  if (recommendation === "suggestedClose") {
    return "Sugerido";
  }

  if (recommendation === "optionalClose") {
    return "Opcional";
  }

  if (recommendation === "neverClose") {
    return "Protegido";
  }

  return "Manter";
}

function recommendationVisual(recommendation: GamerRecommendation) {
  if (recommendation === "suggestedClose") {
    return "bg-primary/10 text-primary border-primary/20";
  }

  if (recommendation === "optionalClose") {
    return "bg-warning/15 text-warning border-warning/25";
  }

  if (recommendation === "neverClose") {
    return "bg-success/15 text-success border-success/25";
  }

  return "bg-muted text-muted-foreground border-border";
}

function actionLabel(actionId: string) {
  if (actionId === "set-balanced-power-plan") {
    return "Plano de energia Equilibrado";
  }

  if (actionId === "set-power-saver-power-plan") {
    return "Plano de energia Economia";
  }

  if (actionId === "set-high-performance-power-plan") {
    return "Plano de energia Alto Desempenho";
  }

  if (actionId === "disable-transparency") {
    return "Transparencias reduzidas";
  }

  if (actionId === "disable-window-animations") {
    return "Animacoes reduzidas";
  }

  if (actionId === "disable-visual-shadows") {
    return "Sombras reduzidas";
  }

  return actionId;
}
