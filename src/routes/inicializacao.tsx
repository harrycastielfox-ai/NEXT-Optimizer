import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ListChecks,
  Power,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SafeTestModeNotice } from "@/components/common/SafeTestModeNotice";
import { Sidebar } from "@/components/dashboard/Sidebar";
import {
  applyStartupEngine,
  fallbackStartupReport,
  loadStartupReport,
  refreshStartupReport,
  type StartupApplyAction,
  type StartupApplyResult,
  type StartupImpact,
  type StartupItem,
  type StartupReport,
} from "@/lib/startup";
import { HERMES_SAFE_TEST_MODE } from "@/lib/safe-mode";

export const Route = createFileRoute("/inicializacao")({
  head: () => ({
    meta: [
      { title: "NEXT Optimizer - Inicialização" },
      {
        name: "description",
        content: "Leitura local dos programas de inicialização do NEXT Optimizer.",
      },
    ],
  }),
  component: InicializacaoPage,
});

function InicializacaoPage() {
  const [report, setReport] = useState<StartupReport>(fallbackStartupReport);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [result, setResult] = useState<StartupApplyResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshStartup(false);
    }, 40);

    return () => {
      requestRef.current += 1;
      window.clearTimeout(timer);
    };
  }, []);

  const selectableItems = useMemo(() => report.items.filter(isItemControllable), [report.items]);
  const selectedItems = useMemo(
    () => report.items.filter((item) => selectedIds.includes(item.id)),
    [report.items, selectedIds],
  );

  async function refreshStartup(force = true) {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setIsLoading(true);
    setError(null);

    try {
      const nextReport = force ? await refreshStartupReport() : await loadStartupReport();
      if (requestRef.current !== requestId) {
        return;
      }

      setReport(nextReport);
      setSelectedIds((current) =>
        current.filter((id) =>
          nextReport.items.some((item) => item.id === id && isItemControllable(item)),
        ),
      );
    } catch (nextError) {
      if (requestRef.current !== requestId) {
        return;
      }

      setError(errorMessage(nextError));
    } finally {
      if (requestRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }

  function toggleSelection(item: StartupItem) {
    if (!isItemControllable(item) || isWorking) {
      return;
    }

    setSelectedIds((current) =>
      current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id],
    );
  }

  async function runStartupAction(action: StartupApplyAction) {
    const applicableItems = selectedItems.filter((item) => isItemSelectable(item, action));
    if (applicableItems.length === 0) {
      setError(
        action === "disable"
          ? "Selecione pelo menos um item ativo que possa ser desativado."
          : "Selecione pelo menos um item desativado que possa ser reativado.",
      );
      return;
    }

    const actionLabel = action === "disable" ? "desativar" : "reativar";
    if (!HERMES_SAFE_TEST_MODE) {
      const confirmed = window.confirm(
        `Confirmar ${actionLabel} ${applicableItems.length} item(ns) de inicialização?\n\n` +
          applicableItems.map((item) => `- ${item.name}`).join("\n") +
          "\n\nO NEXT não remove programas, não apaga executáveis e criará snapshot/log/rollback antes da ação.",
      );

      if (!confirmed) {
        setNotice("Ação de inicialização cancelada antes de alterar o Windows.");
        return;
      }
    } else {
      setNotice(
        "Modo Seguro de Teste ativo: esta ação será executada como dry-run, sem alterar inicialização.",
      );
    }

    setIsWorking(true);
    setNotice(null);
    setError(null);
    setResult(null);

    try {
      const nextResult = await applyStartupEngine({
        action,
        confirmed: !HERMES_SAFE_TEST_MODE,
        dryRun: HERMES_SAFE_TEST_MODE,
        itemIds: applicableItems.map((item) => item.id),
      });
      setResult(nextResult);
      setNotice(nextResult.message);
      await refreshStartup();
      if (!HERMES_SAFE_TEST_MODE) {
        setSelectedIds([]);
      }
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="lightning-bg min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 px-5 pt-6 pb-4 overflow-auto xl:px-8 xl:pt-7">
          <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold tracking-[0.22em] text-primary mb-2">
                STARTUP ENGINE
              </p>
              <h1 className="text-[clamp(26px,2vw,32px)] leading-tight font-bold tracking-tight text-foreground">
                Inicialização
              </h1>
              <p className="text-[13px] text-muted-foreground mt-1">
                Controle seguro dos programas que iniciam com o Windows. O NEXT nunca remove
                programas nem apaga executáveis.
              </p>
            </div>
            <button
              type="button"
              onClick={() => refreshStartup(true)}
              disabled={isLoading || isWorking}
              className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:bg-muted disabled:opacity-60"
            >
              <RefreshCcw className="h-4 w-4 text-primary" />
              Reescanear
            </button>
          </div>

          <SafeTestModeNotice />

          <div className="grid grid-cols-1 gap-3 mb-4 lg:grid-cols-4">
            <SummaryCard
              icon={ListChecks}
              label="ITENS ENCONTRADOS"
              value={`${report.totalItems}`}
              sub={isLoading ? "Atualizando leitura" : "Leitura local"}
            />
            <SummaryCard
              icon={Zap}
              label="ALTO IMPACTO"
              value={`${report.highImpactCount}`}
              sub="Prioridade de revisão"
            />
            <SummaryCard
              icon={Clock}
              label="MEDIO IMPACTO"
              value={`${report.mediumImpactCount}`}
              sub="Pode afetar boot"
            />
            <SummaryCard
              icon={ShieldCheck}
              label="CONTROLAVEIS"
              value={`${selectableItems.length}`}
              sub="Snapshot e rollback"
            />
          </div>

          <section className="rounded-2xl bg-card border border-border/60 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-sm font-bold tracking-[0.18em] text-primary">
                  PROGRAMAS DE INICIALIZACAO
                </h2>
                <p className="text-[12px] text-muted-foreground mt-1">
                  Selecione os programas e use Desativar ou Reativar. Ações reais exigem
                  confirmação, snapshot, log e rollback.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ActionButton
                  icon={Power}
                  label="Desativar"
                  onClick={() => runStartupAction("disable")}
                  disabled={
                    !selectedItems.some((item) => isItemSelectable(item, "disable")) || isWorking
                  }
                  primary
                />
                <ActionButton
                  icon={RotateCcw}
                  label="Reativar"
                  onClick={() => runStartupAction("enable")}
                  disabled={
                    !selectedItems.some((item) => isItemSelectable(item, "enable")) || isWorking
                  }
                />
              </div>
            </div>

            {notice && <ResultBox tone="success" message={notice} />}
            {error && <ResultBox tone="danger" message={error} />}
            {result && (
              <div className="mb-4 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 text-[12px] text-muted-foreground">
                <p className="font-bold text-foreground">
                  Snapshot: <span className="text-primary">{result.snapshotId}</span>
                </p>
                <p className="mt-1">
                  Itens selecionados: {result.selectedItems} | Alterados: {result.changedItems} |
                  Ignorados: {result.skippedItems} | Falhas: {result.failedItems}
                </p>
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-border/70">
              <div className="hidden grid-cols-[0.35fr_1.05fr_1.45fr_0.7fr_0.75fr] bg-muted/40 px-4 py-3 text-[11px] font-bold tracking-wider text-muted-foreground md:grid">
                <span></span>
                <span>NOME</span>
                <span>CAMINHO</span>
                <span>IMPACTO</span>
                <span>STATUS</span>
              </div>

              <div className="divide-y divide-border/70">
                {report.items.map((item) => (
                  <div
                    key={item.id}
                    className="grid gap-3 px-4 py-3 md:grid-cols-[0.35fr_1.05fr_1.45fr_0.7fr_0.75fr] md:items-center"
                  >
                    <label
                      className="flex items-center"
                      title={
                        isItemControllable(item)
                          ? "Item controlável pelo NEXT."
                          : item.controlReason
                      }
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        disabled={!isItemControllable(item) || isWorking}
                        onChange={() => toggleSelection(item)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary disabled:opacity-35"
                        aria-label={`Selecionar ${item.name}`}
                      />
                    </label>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{item.name}</p>
                      <p className="text-[11px] text-muted-foreground md:hidden">
                        {item.controlReason || item.location}
                      </p>
                    </div>
                    <p
                      className="min-w-0 truncate text-[12px] text-muted-foreground"
                      title={item.command}
                    >
                      {item.command}
                    </p>
                    <ImpactBadge impact={item.impact} />
                    <StatusBadge item={item} />
                  </div>
                ))}

                {report.items.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum programa de inicialização foi encontrado pela leitura local.
                  </div>
                )}
              </div>
            </div>

            {report.warnings.length > 0 && (
              <div className="mt-3 rounded-xl bg-warning/10 px-3 py-2 text-[12px] text-warning">
                {report.warnings[0]}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  primary,
}: {
  icon: typeof Zap;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl px-3 text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        primary
          ? "bg-primary text-primary-foreground hover:bg-primary/95"
          : "border border-border bg-background text-foreground hover:bg-muted"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function ResultBox({ tone, message }: { tone: "success" | "danger"; message: string }) {
  const className =
    tone === "success"
      ? "border-success/20 bg-success/10 text-success"
      : "border-destructive/20 bg-destructive/10 text-destructive";

  return (
    <div
      className={`mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-[12px] font-semibold ${className}`}
    >
      {tone === "success" ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span>{message}</span>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Zap;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-4 flex items-center gap-3 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
      <div className="w-11 h-11 rounded-xl bg-primary-soft flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold tracking-wider text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold leading-tight">{value}</p>
        <p className="text-[11px] text-muted-foreground truncate">{sub}</p>
      </div>
    </div>
  );
}

function ImpactBadge({ impact }: { impact: StartupImpact }) {
  const config = {
    high: { label: "Alto", className: "bg-warning/15 text-warning border-warning/25" },
    medium: { label: "Médio", className: "bg-info/15 text-info border-info/25" },
    low: { label: "Baixo", className: "bg-success/15 text-success border-success/25" },
  }[impact];

  return (
    <span
      className={`w-fit rounded-full border px-3 py-1 text-[11px] font-bold ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function StatusBadge({ item }: { item: StartupItem }) {
  const isDisabled = item.status === "disabled";
  const label = isDisabled ? "Desativado" : item.status === "active" ? "Ativo" : "Desconhecido";
  const className = isDisabled
    ? "border-muted bg-muted text-muted-foreground"
    : "border-success/20 bg-success/10 text-success";

  return (
    <span
      className={`w-fit rounded-full border px-3 py-1 text-[11px] font-bold ${className}`}
      title={item.controlReason}
    >
      {label}
    </span>
  );
}

function isItemSelectable(item: StartupItem, action: StartupApplyAction) {
  if (action === "disable") {
    return item.status === "active" && item.canDisableLater && item.controllable;
  }

  return item.status === "disabled" && item.canEnableLater && item.controllable;
}

function isItemControllable(item: StartupItem) {
  return isItemSelectable(item, "disable") || isItemSelectable(item, "enable");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
