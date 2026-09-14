import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  FileText,
  FolderOpen,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SafeTestModeNotice } from "@/components/common/SafeTestModeNotice";
import { Sidebar } from "@/components/dashboard/Sidebar";
import {
  applyCleanEngine,
  fallbackCleanScanReport,
  loadCleanScanReport,
  refreshCleanScanReport,
  type CleanApplyResult,
  type CleanScanItem,
  type CleanScanReport,
} from "@/lib/clean";
import { HERMES_SAFE_TEST_MODE } from "@/lib/safe-mode";

export const Route = createFileRoute("/limpeza")({
  head: () => ({
    meta: [
      { title: "NEXT Optimizer - Limpeza" },
      { name: "description", content: "Scan de limpeza segura local do NEXT Optimizer." },
    ],
  }),
  component: LimpezaPage,
});

function LimpezaPage() {
  const [report, setReport] = useState<CleanScanReport>(fallbackCleanScanReport);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    fallbackCleanScanReport.items.filter((item) => item.selectedByDefault).map((item) => item.id),
  );
  const [result, setResult] = useState<CleanApplyResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshCleanScan(false);
    }, 40);

    return () => {
      requestRef.current += 1;
      window.clearTimeout(timer);
    };
  }, []);

  const selectedItems = useMemo(
    () => report.items.filter((item) => selectedIds.includes(item.id) && item.safeToCleanLater),
    [report.items, selectedIds],
  );
  const selectedBytes = selectedItems.reduce((total, item) => total + item.estimatedBytes, 0);
  const selectedGb = selectedItems.reduce((total, item) => total + item.estimatedGb, 0);

  async function refreshCleanScan(force = true) {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setIsLoading(true);
    setError(null);

    try {
      const nextReport = force ? await refreshCleanScanReport() : await loadCleanScanReport();
      if (requestRef.current !== requestId) {
        return;
      }

      setReport(nextReport);
      setSelectedIds((current) => {
        const validCurrent = current.filter((id) =>
          nextReport.items.some((item) => item.id === id && item.safeToCleanLater),
        );
        if (validCurrent.length > 0) {
          return validCurrent;
        }

        return nextReport.items
          .filter((item) => item.selectedByDefault && item.safeToCleanLater)
          .map((item) => item.id);
      });
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

  function toggleSelection(item: CleanScanItem) {
    if (!item.safeToCleanLater || isWorking) {
      return;
    }

    setSelectedIds((current) =>
      current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id],
    );
  }

  function selectSafeDefaults() {
    setSelectedIds(
      report.items
        .filter((item) => item.selectedByDefault && item.safeToCleanLater)
        .map((item) => item.id),
    );
    setNotice("Itens seguros recomendados foram selecionados.");
    setError(null);
  }

  async function runClean(dryRun: boolean) {
    if (selectedItems.length === 0) {
      setError("Selecione pelo menos uma categoria segura antes de continuar.");
      return;
    }

    if (!dryRun && !HERMES_SAFE_TEST_MODE) {
      const confirmed = window.confirm(
        `Confirmar limpeza segura de ${selectedItems.length} categoria(s)?\n\n` +
          selectedItems
            .map((item) => `- ${item.label}: ${formatGb(item.estimatedGb)} GB`)
            .join("\n") +
          `\n\nTotal estimado: ${formatGb(selectedGb)} GB.\n\nO NEXT moverá arquivos allowlistados para quarentena, criará snapshot/log/rollback e nunca tocará Downloads, Documentos, Desktop, Imagens ou Vídeos.`,
      );

      if (!confirmed) {
        setNotice("Limpeza cancelada antes de mover qualquer arquivo.");
        return;
      }
    } else if (!dryRun && HERMES_SAFE_TEST_MODE) {
      setNotice(
        "Modo Seguro de Teste ativo: a limpeza será validada em dry-run, sem mover arquivos.",
      );
    }

    setIsWorking(true);
    setNotice(null);
    setError(null);
    setResult(null);

    try {
      const nextResult = await applyCleanEngine({
        confirmed: !dryRun && !HERMES_SAFE_TEST_MODE,
        dryRun: dryRun || HERMES_SAFE_TEST_MODE,
        itemIds: selectedItems.map((item) => item.id),
      });
      setResult(nextResult);
      setNotice(nextResult.message);
      await refreshCleanScan();
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
              <p className="text-xs font-bold tracking-[0.22em] text-primary mb-2">CLEAN ENGINE</p>
              <h1 className="text-[clamp(26px,2vw,32px)] leading-tight font-bold tracking-tight text-foreground">
                Limpeza segura
              </h1>
              <p className="text-[13px] text-muted-foreground mt-1">
                Primeiro escaneia, depois limpa apenas categorias allowlistadas com quarentena,
                snapshot, log e rollback.
              </p>
            </div>
            <button
              type="button"
              onClick={() => refreshCleanScan(true)}
              disabled={isLoading || isWorking}
              className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:bg-muted disabled:opacity-60"
            >
              <RefreshCcw className="h-4 w-4 text-primary" />
              Reescanear
            </button>
          </div>

          <SafeTestModeNotice />

          <div className="grid grid-cols-1 gap-3 mb-4 lg:grid-cols-3">
            <SummaryCard
              icon={Sparkles}
              label="A LIBERAR"
              value={`${formatGb(selectedGb || report.totalGb)} GB`}
              sub={
                selectedItems.length > 0 ? "Selecionados para limpeza" : "Disponiveis para limpeza"
              }
            />
            <SummaryCard
              icon={CheckCircle2}
              label="ITENS SELECIONADOS"
              value={`${selectedItems.length}/${report.items.length}`}
              sub={isLoading ? "Atualizando scan" : "Categorias allowlistadas"}
            />
            <SummaryCard
              icon={ShieldCheck}
              label="PASTAS PROTEGIDAS"
              value="Nunca tocadas"
              sub={report.protectedLocations.slice(0, 3).join(", ")}
            />
          </div>

          <section className="rounded-2xl bg-card border border-border/60 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-sm font-bold tracking-[0.18em] text-primary">
                  ITENS ENCONTRADOS
                </h2>
                <p className="text-[12px] text-muted-foreground mt-1">
                  {formatGb(report.totalGb)} GB encontrados no scan. Limpeza real sempre exige
                  confirmação final.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ControlButton
                  label="Selecionar seguros"
                  onClick={selectSafeDefaults}
                  disabled={isWorking}
                />
                <ControlButton
                  label="Validar"
                  onClick={() => runClean(true)}
                  disabled={selectedItems.length === 0 || isWorking}
                />
                <ControlButton
                  label={HERMES_SAFE_TEST_MODE ? "Validar seguro" : "Limpar agora"}
                  onClick={() => runClean(false)}
                  disabled={selectedItems.length === 0 || isWorking}
                  primary
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
                  Planejados: {result.plannedEntries} | Quarentena: {result.quarantinedEntries} |
                  Ignorados: {result.skippedEntries} | Falhas: {result.failedEntries}
                </p>
                <p className="mt-1 flex items-center gap-1 text-primary">
                  <Archive className="h-3.5 w-3.5" />
                  Retencao da quarentena: {result.quarantineRetentionDays} dias.
                </p>
              </div>
            )}

            <div className="space-y-2.5">
              {report.items.map((item) => (
                <CleanRow
                  key={item.id}
                  item={item}
                  totalBytes={report.totalBytes}
                  selected={selectedIds.includes(item.id)}
                  disabled={isWorking}
                  onToggle={() => toggleSelection(item)}
                />
              ))}
            </div>

            <div className="mt-4 flex flex-col gap-2 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] text-muted-foreground">
                Protegido: {report.protectedLocations.join(", ")}.
              </p>
              <p className="text-sm font-semibold text-foreground">
                Total selecionado:{" "}
                <span className="text-primary">{formatGb(bytesToGb(selectedBytes))} GB</span>
              </p>
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

function ControlButton({
  label,
  onClick,
  disabled,
  primary,
}: {
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
      className={`inline-flex h-9 items-center justify-center rounded-xl px-3 text-[12px] font-bold transition disabled:opacity-50 ${
        primary
          ? "bg-primary text-primary-foreground hover:bg-primary/95"
          : "border border-border bg-background text-foreground hover:bg-muted"
      }`}
    >
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
  icon: typeof Sparkles;
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

function CleanRow({
  item,
  totalBytes,
  selected,
  disabled,
  onToggle,
}: {
  item: CleanScanItem;
  totalBytes: number;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const percent =
    totalBytes > 0 ? Math.max(4, Math.round((item.estimatedBytes / totalBytes) * 100)) : 0;
  const Icon = getIcon(item.id);

  return (
    <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <input
            type="checkbox"
            checked={selected}
            disabled={!item.safeToCleanLater || disabled}
            onChange={onToggle}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary disabled:opacity-35"
            aria-label={`Selecionar ${item.label}`}
          />
          <div className="w-10 h-10 rounded-xl bg-primary-soft flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{item.label}</p>
            <p className="text-[12px] text-muted-foreground truncate">{item.description}</p>
          </div>
        </div>
        <p className="text-sm font-semibold text-primary">{formatGb(item.estimatedGb)} GB</p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      {item.paths.length > 0 && (
        <p
          className="mt-2 truncate text-[11px] text-muted-foreground"
          title={item.paths.join(" | ")}
        >
          {item.paths[0]}
        </p>
      )}
    </div>
  );
}

function getIcon(id: string) {
  if (id === "logs") {
    return FileText;
  }

  if (id === "cache" || id === "windows-update-cache") {
    return Database;
  }

  if (id === "thumbnails") {
    return FolderOpen;
  }

  return Trash2;
}

function formatGb(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: value > 0 && value < 1 ? 1 : 0,
  }).format(value);
}

function bytesToGb(value: number) {
  return value / 1024 / 1024 / 1024;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
