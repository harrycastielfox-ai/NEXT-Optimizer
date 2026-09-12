import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  FileText,
  History,
  ListChecks,
  LockKeyhole,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SafeTestModeNotice } from "@/components/common/SafeTestModeNotice";
import { Sidebar } from "@/components/dashboard/Sidebar";
import {
  applyRestoreSnapshot,
  getRestoreEngineStatus,
  listRestoreEvents,
  listRestoreSnapshots,
  validateRestoreSnapshot,
  type RestoreApplyResult,
  type RestoreEngineStatus,
  type RestoreEventList,
  type RestoreSnapshot,
  type RestoreSnapshotList,
  type RestoreValidationResult,
} from "@/lib/restore";

export const Route = createFileRoute("/seguranca")({
  head: () => ({
    meta: [
      { title: "NEXT Optimizer - Segurança e Recuperacao" },
      { name: "description", content: "Snapshots, logs e rollback local do NEXT Optimizer." },
    ],
  }),
  component: SecurityRecoveryPage,
});

function SecurityRecoveryPage() {
  const [status, setStatus] = useState<RestoreEngineStatus | null>(null);
  const [snapshots, setSnapshots] = useState<RestoreSnapshotList | null>(null);
  const [events, setEvents] = useState<RestoreEventList | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [validation, setValidation] = useState<RestoreValidationResult | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreApplyResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    void loadSecurityCenter();

    return () => {
      requestRef.current += 1;
    };
  }, []);

  async function loadSecurityCenter() {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setIsLoading(true);
    setError(null);

    try {
      const [nextStatus, nextSnapshots, nextEvents] = await Promise.all([
        getRestoreEngineStatus(),
        listRestoreSnapshots(),
        listRestoreEvents(),
      ]);

      if (requestRef.current !== requestId) {
        return;
      }

      setStatus(nextStatus);
      setSnapshots(nextSnapshots);
      setEvents(nextEvents);
      setSelectedSnapshotId((current) => current ?? nextSnapshots.snapshots[0]?.id ?? null);
    } catch (nextError) {
      if (requestRef.current === requestId) {
        setError(errorMessage(nextError));
      }
    } finally {
      if (requestRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }

  const selectedSnapshot = useMemo(
    () =>
      snapshots?.snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ??
      snapshots?.snapshots[0] ??
      null,
    [snapshots, selectedSnapshotId],
  );

  async function runValidation(snapshot: RestoreSnapshot) {
    setIsWorking(true);
    setNotice(null);
    setError(null);
    setValidation(null);
    setRestoreResult(null);

    try {
      const result = await validateRestoreSnapshot(snapshot.id);
      setValidation(result);
      await loadSecurityCenter();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setIsWorking(false);
    }
  }

  async function runRestore(snapshot: RestoreSnapshot) {
    const dryRunConfirmed = window.confirm(
      `Validar snapshot antes de restaurar?\n\n${snapshot.name}\n${snapshot.id}\n\nNenhuma alteração será aplicada nesta validação.`,
    );
    if (!dryRunConfirmed) {
      return;
    }

    setIsWorking(true);
    setNotice(null);
    setError(null);
    setValidation(null);
    setRestoreResult(null);

    try {
      const validationResult = await validateRestoreSnapshot(snapshot.id);
      setValidation(validationResult);

      const restoreConfirmed = window.confirm(
        `Restaurar este snapshot agora?\n\n${snapshot.name}\nAções reversíveis: ${snapshot.rollbackManifest.length}\n\nO NEXT executará apenas rollback suportado pelo manifesto seguro.`,
      );
      if (!restoreConfirmed) {
        setNotice("Restauração cancelada após validação segura.");
        await loadSecurityCenter();
        return;
      }

      const result = await applyRestoreSnapshot(snapshot.id, false);
      setRestoreResult(result);
      await loadSecurityCenter();
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setIsWorking(false);
    }
  }

  function exportReport() {
    setNotice(null);
    setError(null);

    try {
      const payload = {
        generatedAt: new Date().toISOString(),
        source: "NEXT Optimizer - Segurança e Recuperacao",
        localOnly: true,
        status,
        snapshots,
        events,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `hermes-security-report-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice("Relatório local exportado com snapshots, logs e status do Restore Engine.");
    } catch (nextError) {
      setError(errorMessage(nextError));
    }
  }

  function prepareHistoryClear() {
    const confirmation = window.prompt(
      "Limpar histórico local exigirá uma bridge segura em fase futura.\n\nDigite LIMPAR HISTORICO para registrar sua confirmação sem apagar nada agora.",
    );

    if (confirmation !== "LIMPAR HISTORICO") {
      setNotice("Limpeza de histórico cancelada.");
      return;
    }

    setNotice("Confirmação forte recebida. Nenhum histórico foi apagado nesta etapa.");
  }

  return (
    <div className="lightning-bg min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 overflow-auto px-5 pt-6 pb-4 xl:px-8 xl:pt-7">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="mb-2 text-xs font-bold tracking-[0.22em] text-primary">
                SEGURANCA E RECUPERACAO
              </p>
              <h1 className="text-[clamp(26px,2vw,34px)] font-bold leading-tight tracking-tight text-foreground">
                Restore Center NEXT
              </h1>
              <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
                Snapshots, rollback, logs locais, histórico de alterações e exportação de relatório
                sem nuvem.
              </p>
            </div>
            <button
              type="button"
              onClick={loadSecurityCenter}
              disabled={isLoading || isWorking}
              className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:bg-muted disabled:opacity-60"
            >
              <RefreshCcw className="h-4 w-4 text-primary" />
              Atualizar
            </button>
          </div>

          <SafeTestModeNotice />

          <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatusCard
              icon={Database}
              label="SNAPSHOTS"
              value={status ? `${status.totalSnapshots}/${status.maxSnapshots}` : "--"}
              sub={status?.retentionPolicy ?? "Carregando histórico local"}
            />
            <StatusCard
              icon={History}
              label="LOGS"
              value={status ? `${status.totalEvents}/${status.maxEvents}` : "--"}
              sub="Eventos locais do Restore Engine"
            />
            <StatusCard
              icon={RotateCcw}
              label="ROLLBACK"
              value={status ? `${status.snapshotsWithRollback}` : "--"}
              sub="Snapshots com manifesto reversível"
            />
            <StatusCard
              icon={LockKeyhole}
              label="ESTADO BASE"
              value="Futuro"
              sub="Requisito registrado para salvar o estado inicial do PC"
              tone="warning"
            />
          </section>

          <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_34px_-20px_rgba(15,23,42,0.16)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                  <ShieldCheck className="h-6 w-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-foreground">Snapshots e rollback</h2>
                  <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                    Toda restauração passa por validação antes de aplicar. Em Safe Test Mode, a
                    bridge TypeScript forca dry-run.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                <SecurityActionButton
                  icon={Download}
                  label="Exportar"
                  onClick={exportReport}
                  disabled={isLoading}
                />
                <SecurityActionButton
                  icon={Trash2}
                  label="Limpar histórico"
                  onClick={prepareHistoryClear}
                  disabled={isLoading || isWorking}
                />
              </div>
            </div>

            {status?.warnings && status.warnings.length > 0 && (
              <div className="mt-4 rounded-xl border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{status.warnings[0]}</span>
                </div>
              </div>
            )}

            {notice && (
              <div className="mt-4 rounded-xl border border-success/20 bg-success/10 px-4 py-3 text-sm font-semibold text-success">
                {notice}
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
                {error}
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
              <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-[12px] font-bold tracking-[0.18em] text-primary">
                      SNAPSHOTS
                    </h3>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      Retencao local maxima de 10 snapshots.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <SecurityActionButton
                      icon={ListChecks}
                      label="Validar"
                      onClick={() => selectedSnapshot && runValidation(selectedSnapshot)}
                      disabled={!selectedSnapshot || isWorking}
                    />
                    <SecurityActionButton
                      icon={RotateCcw}
                      label="Restaurar"
                      onClick={() => selectedSnapshot && runRestore(selectedSnapshot)}
                      disabled={!selectedSnapshot || isWorking}
                      primary
                    />
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {snapshots?.snapshots.length ? (
                    snapshots.snapshots.map((snapshot) => (
                      <SnapshotRow
                        key={snapshot.id}
                        snapshot={snapshot}
                        selected={snapshot.id === selectedSnapshot?.id}
                        onSelect={() => setSelectedSnapshotId(snapshot.id)}
                      />
                    ))
                  ) : (
                    <EmptyState
                      icon={Database}
                      title="Nenhum snapshot local"
                      sub="Os snapshots aparecerão aqui após a primeira ação com Restore Engine."
                    />
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                  <h3 className="text-[12px] font-bold tracking-[0.18em] text-primary">
                    RESTAURAR ALTERACOES
                  </h3>
                  {selectedSnapshot ? (
                    <div className="mt-3 space-y-3">
                      <SelectedSnapshotDetails snapshot={selectedSnapshot} />
                      {validation && (
                        <ResultBox
                          title={
                            validation.fullyReversible
                              ? "Snapshot reversível"
                              : "Snapshot validado com atenção"
                          }
                          message={validation.message}
                          tone={validation.fullyReversible ? "success" : "warning"}
                        />
                      )}
                      {restoreResult && (
                        <ResultBox
                          title={
                            restoreResult.applied
                              ? "Restauração aplicada"
                              : "Restauração registrada"
                          }
                          message={restoreResult.message}
                          tone={restoreResult.applied ? "success" : "warning"}
                        />
                      )}
                    </div>
                  ) : (
                    <EmptyState
                      icon={RotateCcw}
                      title="Selecione um snapshot"
                      sub="A restauração real sempre exige confirmação antes de executar."
                    />
                  )}
                </div>

                <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
                  <h3 className="text-[12px] font-bold tracking-[0.18em] text-primary">
                    LOGS DO SISTEMA
                  </h3>
                  <div className="mt-3 space-y-2">
                    {events?.events.length ? (
                      events.events
                        .slice(0, 7)
                        .map((event) => <EventRow key={event.id} event={event} />)
                    ) : (
                      <EmptyState
                        icon={FileText}
                        title="Sem logs recentes"
                        sub="Eventos de snapshot, validação e rollback aparecerão aqui."
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function SecurityActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  primary,
}: {
  icon: typeof ShieldCheck;
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
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition disabled:opacity-60 ${
        primary
          ? "bg-primary text-primary-foreground shadow-[0_10px_26px_-14px_rgba(37,99,235,0.85)] hover:bg-primary/95"
          : "border border-border bg-card text-foreground hover:bg-muted"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function StatusCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "success" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "text-success bg-success/10"
      : tone === "warning"
        ? "text-warning bg-warning/10"
        : "text-primary bg-primary-soft";

  return (
    <div className="rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_30px_-22px_rgba(15,23,42,0.2)]">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneClass}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-wider text-muted-foreground">{label}</p>
          <p className="text-xl font-bold leading-tight text-foreground">{value}</p>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{sub}</p>
    </div>
  );
}

function SnapshotRow({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: RestoreSnapshot;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border px-3 py-3 text-left transition ${
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
          : "border-border/70 bg-card hover:border-primary/35"
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-bold text-foreground">{snapshot.name}</p>
            <StatusPill status={snapshot.status} />
          </div>
          <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">
            {snapshot.description}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" />
          {formatTimestamp(snapshot.timestamp)}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <MiniStat label="Ações" value={`${snapshot.plannedActions.length}`} />
        <MiniStat label="Rollback" value={`${snapshot.rollbackManifest.length}`} />
        <MiniStat label="Estado" value={`${snapshot.previousState.length}`} />
      </div>
    </button>
  );
}

function SelectedSnapshotDetails({ snapshot }: { snapshot: RestoreSnapshot }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <RotateCcw className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">{snapshot.name}</p>
          <p className="mt-1 break-all text-[11px] text-muted-foreground">{snapshot.id}</p>
        </div>
      </div>
      <div className="mt-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-[12px] text-muted-foreground">
        {snapshot.reversalPlan.summary}
      </div>
      <div className="mt-3 space-y-2">
        {snapshot.rollbackManifest.slice(0, 4).map((action) => (
          <div key={action.id} className="flex items-start gap-2 text-[12px] text-foreground">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>{action.description}</span>
          </div>
        ))}
        {snapshot.rollbackManifest.length === 0 && (
          <p className="text-[12px] text-muted-foreground">
            Snapshot estrutural sem ações reversiveis registradas.
          </p>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: NonNullable<RestoreEventList["events"][number]> }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-semibold leading-relaxed text-foreground">{event.message}</p>
        <LogLevelPill level={event.level} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>{formatTimestamp(event.timestamp)}</span>
        {event.snapshotId && (
          <span className="max-w-[220px] truncate">Snapshot: {event.snapshotId}</span>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  sub,
}: {
  icon: typeof ShieldCheck;
  title: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/70 px-4 py-5 text-center">
      <Icon className="mx-auto h-6 w-6 text-muted-foreground" />
      <p className="mt-2 text-sm font-bold text-foreground">{title}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function ResultBox({
  title,
  message,
  tone,
}: {
  title: string;
  message: string;
  tone: "success" | "warning";
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-3 ${tone === "success" ? "border-success/20 bg-success/10" : "border-warning/25 bg-warning/10"}`}
    >
      <p className={`text-sm font-bold ${tone === "success" ? "text-success" : "text-warning"}`}>
        {title}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{message}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/70 px-2 py-1.5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: RestoreSnapshot["status"] }) {
  const className =
    status === "applied"
      ? "border-success/20 bg-success/10 text-success"
      : status === "failed"
        ? "border-destructive/20 bg-destructive/10 text-destructive"
        : "border-primary/20 bg-primary/10 text-primary";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${className}`}>
      {snapshotStatusLabel(status)}
    </span>
  );
}

function LogLevelPill({ level }: { level: RestoreEventList["events"][number]["level"] }) {
  const className =
    level === "error"
      ? "border-destructive/20 bg-destructive/10 text-destructive"
      : level === "warning"
        ? "border-warning/25 bg-warning/10 text-warning"
        : "border-primary/20 bg-primary/10 text-primary";

  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${className}`}>
      {levelLabel(level)}
    </span>
  );
}

function snapshotStatusLabel(status: RestoreSnapshot["status"]) {
  if (status === "dryRun") {
    return "Dry-run";
  }

  if (status === "validated") {
    return "Validado";
  }

  if (status === "applied") {
    return "Aplicado";
  }

  if (status === "failed") {
    return "Falha";
  }

  return "Criado";
}

function levelLabel(level: RestoreEventList["events"][number]["level"]) {
  if (level === "error") {
    return "Erro";
  }

  if (level === "warning") {
    return "Aviso";
  }

  return "Info";
}

function formatTimestamp(value: string) {
  const numeric = Number(value);
  const date =
    Number.isFinite(numeric) && value.length <= 13 ? new Date(numeric * 1000) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
