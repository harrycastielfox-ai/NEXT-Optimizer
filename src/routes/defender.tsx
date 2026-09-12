import { createFileRoute } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  Info,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  ShieldPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import {
  applyAdvancedActions,
  loadAdvancedCatalog,
  refreshAdvancedCatalog,
  type AdvancedAction,
} from "@/lib/advanced";
import { HERMES_SAFE_TEST_MODE } from "@/lib/safe-mode";
import {
  fallbackSystemSecurityContext,
  openWindowsSecurity,
  readSystemSecurityContext,
  type SystemSecurityContext,
} from "@/lib/system";

type ActionStatus = "idle" | "running" | "done" | "failed";

const DEFENDER_ACTION_ID = "allow-hermes-defender-exclusion";

export const Route = createFileRoute("/defender")({
  head: () => ({
    meta: [
      { title: "NEXT Optimizer - Windows Defender" },
      {
        name: "description",
        content: "Liberacao especifica do NEXT no Windows Defender sem desativar a protecao.",
      },
    ],
  }),
  component: DefenderPage,
});

function DefenderPage() {
  const [systemContext, setSystemContext] = useState<SystemSecurityContext>(
    fallbackSystemSecurityContext,
  );
  const [defenderAction, setDefenderAction] = useState<AdvancedAction | null>(null);
  const [loadingState, setLoadingState] = useState(false);
  const [actionStatus, setActionStatus] = useState<ActionStatus>("idle");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [securityStatus, setSecurityStatus] = useState<ActionStatus>("idle");
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);
  const [manualStepsOpen, setManualStepsOpen] = useState(false);

  const refreshState = useCallback(async (preferCache = false) => {
    setLoadingState(true);
    try {
      const [context, catalog] = await Promise.all([
        readSystemSecurityContext(),
        preferCache ? loadAdvancedCatalog() : refreshAdvancedCatalog(),
      ]);

      setSystemContext(context);
      setDefenderAction(catalog.actions.find((item) => item.id === DEFENDER_ACTION_ID) ?? null);
    } finally {
      setLoadingState(false);
    }
  }, []);

  useEffect(() => {
    void refreshState(true);
  }, [refreshState]);

  const isAlreadyAllowed = useMemo(() => {
    const value = defenderAction?.currentValue.toLowerCase() ?? "";
    return (
      value.includes("já está") ||
      value.includes("ja esta") ||
      value.includes("já aparece") ||
      value.includes("ja aparece")
    );
  }, [defenderAction]);

  const modeLabel = HERMES_SAFE_TEST_MODE ? "Teste" : "Real";
  const adminLabel = systemContext.isElevated ? "Administrador ativo" : "Administrador pendente";
  const statusLabel = isAlreadyAllowed
    ? "NEXT liberado"
    : loadingState
      ? "Verificando permissão"
      : "Liberação recomendada";
  const statusText = isAlreadyAllowed
    ? "O executável atual já aparece nas exclusões do Defender."
    : HERMES_SAFE_TEST_MODE
      ? "Modo teste ativo: o NEXT valida o comando, mas ainda não altera o Windows Defender."
      : "Ao confirmar, o NEXT adiciona apenas o executável atual nas exclusões do Defender.";
  const actionUnavailable =
    !systemContext.isWindows || (!HERMES_SAFE_TEST_MODE && !systemContext.isElevated);

  const actionButtonLabel = useMemo(() => {
    if (actionStatus === "running") {
      return HERMES_SAFE_TEST_MODE ? "Validando..." : "Liberando...";
    }
    if (!systemContext.isWindows) {
      return "Disponível apenas no Windows";
    }
    if (!HERMES_SAFE_TEST_MODE && !systemContext.isElevated) {
      return "Abra como administrador";
    }
    if (isAlreadyAllowed) {
      return HERMES_SAFE_TEST_MODE ? "Validar novamente" : "NEXT já liberado";
    }

    return HERMES_SAFE_TEST_MODE ? "Validar liberação" : "Liberar no Defender";
  }, [actionStatus, isAlreadyAllowed, systemContext.isElevated, systemContext.isWindows]);

  const handleAllowDefender = useCallback(async () => {
    if (actionStatus === "running" || actionUnavailable) {
      return;
    }

    if (!HERMES_SAFE_TEST_MODE) {
      const confirmed = window.confirm(
        "O NEXT vai adicionar somente o executável atual às exclusões do Windows Defender. Continuar?",
      );
      if (!confirmed) {
        return;
      }
    }

    setActionStatus("running");
    setActionMessage(null);

    try {
      const result = await applyAdvancedActions({
        confirmed: !HERMES_SAFE_TEST_MODE,
        dryRun: HERMES_SAFE_TEST_MODE,
        actionIds: [DEFENDER_ACTION_ID],
        extremeMode: false,
      });

      const firstAction = result.appliedActions[0];
      setActionStatus("done");
      setActionMessage(firstAction?.message ?? result.message);
      await refreshState();
    } catch (error) {
      setActionStatus("failed");
      setActionMessage(error instanceof Error ? error.message : String(error));
    }
  }, [actionStatus, actionUnavailable, refreshState]);

  const handleOpenSecurity = useCallback(async () => {
    if (securityStatus === "running") {
      return;
    }

    setSecurityStatus("running");
    setSecurityMessage(null);

    try {
      await openWindowsSecurity();
      setSecurityStatus("done");
      setSecurityMessage("Segurança do Windows aberta.");
    } catch (error) {
      setSecurityStatus("failed");
      setSecurityMessage(error instanceof Error ? error.message : String(error));
    }
  }, [securityStatus]);

  return (
    <div className="lightning-bg flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5 xl:px-7">
          <div className="max-w-7xl">
            <header className="flex flex-col gap-3 xl:flex-row xl:items-stretch xl:justify-between">
              <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-card/45 px-4 py-3 shadow-[0_14px_42px_-36px_rgba(168,85,247,0.7)] backdrop-blur xl:max-w-[720px]">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(216,180,254,0.14),transparent_30%),linear-gradient(120deg,rgba(255,255,255,0.05),transparent_54%)]" />
                <div className="relative flex min-h-[78px] flex-col justify-center">
                  <span className="inline-flex h-5 w-fit items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 text-[8px] font-black uppercase tracking-[0.18em] text-primary">
                    <ShieldCheck className="h-3 w-3" />
                    NEXT Security
                  </span>
                  <h1 className="mt-2 bg-gradient-to-r from-white via-fuchsia-100 to-primary bg-clip-text text-[clamp(24px,2vw,31px)] font-black leading-none tracking-normal text-transparent drop-shadow-[0_0_16px_rgba(168,85,247,0.18)]">
                    Liberar no Windows Defender
                  </h1>
                  <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
                    Libere somente o executável do NEXT quando o Windows bloquear o aplicativo. A
                    proteção do computador continua ativa.
                  </p>
                </div>
              </div>

              <div className="relative grid w-full grid-cols-[0.8fr_0.8fr_1.4fr] overflow-hidden rounded-2xl border border-white/10 bg-card/82 shadow-[0_1px_2px_rgba(0,0,0,0.18),0_16px_34px_-24px_rgba(168,85,247,0.5)] backdrop-blur xl:w-[430px]">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-primary/10 opacity-70" />
                <StatusPill label="Windows" value={systemContext.isWindows ? "Sim" : "Não"} />
                <StatusPill label="Modo" value={modeLabel} divided />
                <StatusPill label="Permissão" value={adminLabel} divided />
              </div>
            </header>

            <section className="relative mt-4 overflow-hidden rounded-[26px] border border-primary/25 bg-card/90 p-4 shadow-[0_26px_70px_-42px_rgba(196,94,255,0.75)]">
              <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="rounded-3xl border border-primary/20 bg-background/70 p-5">
                  <div className="flex items-start gap-4">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
                      {loadingState ? (
                        <Loader2 className="h-6 w-6 animate-spin" />
                      ) : (
                        <ShieldPlus className="h-6 w-6" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
                        {statusLabel}
                      </p>
                      <h2 className="mt-1 text-xl font-black text-foreground">
                        Proteção continua ativa
                      </h2>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {statusText}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleAllowDefender}
                    disabled={actionStatus === "running" || actionUnavailable}
                    className="mt-5 inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl bg-primary px-5 py-3.5 text-base font-black text-primary-foreground shadow-[0_0_30px_rgba(196,94,255,0.36),0_22px_38px_-22px_rgba(196,94,255,0.9)] transition hover:bg-primary/95 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {actionStatus === "running" ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-5 w-5" />
                    )}
                    {actionButtonLabel}
                  </button>

                  {loadingState && actionStatus !== "running" && (
                    <p className="mt-3 text-center text-xs font-semibold text-muted-foreground">
                      Verificando estado atual em segundo plano.
                    </p>
                  )}

                  {actionMessage && (
                    <ActionMessage status={actionStatus} message={actionMessage} className="mt-4" />
                  )}

                  <div className="mt-4 grid gap-2 md:grid-cols-3">
                    <TrustCard
                      icon={FileCheck2}
                      title="Executável atual"
                      text="Somente o arquivo do NEXT em execução."
                    />
                    <TrustCard
                      icon={LockKeyhole}
                      title="Sem pasta inteira"
                      text="Nenhuma pasta completa entra na permissão."
                    />
                    <TrustCard
                      icon={CheckCircle2}
                      title="Defender mantido"
                      text="Proteção, firewall, UAC e SmartScreen ativos."
                    />
                  </div>
                </div>

                <aside className="flex flex-col rounded-3xl border border-border/70 bg-background/70 p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      <Info className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                        Alternativa manual
                      </p>
                      <h2 className="mt-1 text-base font-black leading-tight text-foreground">
                        Se o Windows bloquear antes
                      </h2>
                      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                        Adicione uma exclusão do tipo Arquivo para{" "}
                        <code className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                          nex-optimizer.exe
                        </code>
                        .
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleOpenSecurity}
                    disabled={securityStatus === "running"}
                    className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 text-sm font-black text-primary transition hover:border-primary/70 hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {securityStatus === "running" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ExternalLink className="h-4 w-4" />
                    )}
                    Abrir Segurança do Windows
                  </button>

                  {securityMessage && (
                    <ActionMessage
                      status={securityStatus}
                      message={securityMessage}
                      compact
                      className="mt-3"
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => setManualStepsOpen(true)}
                    className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border/60 bg-card/55 px-4 text-[12px] font-black text-foreground transition hover:border-primary/40 hover:bg-primary/10"
                  >
                    Ver passo a passo
                  </button>
                </aside>
              </div>

              {manualStepsOpen && (
                <div className="absolute inset-4 z-20 flex flex-col rounded-3xl border border-primary/35 bg-background/95 p-5 shadow-[0_28px_70px_-24px_rgba(0,0,0,0.88),0_0_38px_rgba(196,94,255,0.18)] backdrop-blur-xl">
                  <div className="flex items-start justify-between gap-5">
                    <div className="flex items-start gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
                        <Info className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                          Alternativa manual
                        </p>
                        <h2 className="mt-1 text-xl font-black text-foreground">
                          Liberação no Windows Defender
                        </h2>
                        <p className="mt-1 text-[12px] text-muted-foreground">
                          Siga as etapas na ordem indicada para liberar somente o executável do
                          NEXT.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setManualStepsOpen(false)}
                      aria-label="Fechar passo a passo"
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border/70 bg-card text-muted-foreground transition hover:border-primary/50 hover:text-primary"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mt-5 grid flex-1 gap-3 md:grid-cols-3">
                    <div className="grid content-start gap-3">
                      <ManualStep index={1} text="Abra Proteção contra vírus e ameaças." />
                      <ManualStep index={2} text="Entre em Gerenciar configurações." />
                    </div>
                    <div className="grid content-start gap-3">
                      <ManualStep index={3} text="Abra Adicionar ou remover exclusões." />
                      <ManualStep index={4} text="Clique em Adicionar uma exclusão." />
                    </div>
                    <div className="grid content-start gap-3">
                      <ManualStep index={5} text="Selecione Arquivo." />
                      <ManualStep index={6} text="Escolha nex-optimizer.exe e confirme." />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-4 border-t border-border/60 pt-4">
                    <p className="text-[12px] text-muted-foreground">
                      O Defender permanece ativo. A exclusão deve ser aplicada somente ao arquivo
                      <code className="ml-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                        nex-optimizer.exe
                      </code>
                      .
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenSecurity}
                      disabled={securityStatus === "running"}
                      className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-5 text-sm font-black text-primary transition hover:border-primary/70 hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {securityStatus === "running" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ExternalLink className="h-4 w-4" />
                      )}
                      Abrir Segurança do Windows
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function StatusPill({
  label,
  value,
  divided,
}: {
  label: string;
  value: string;
  divided?: boolean;
}) {
  return (
    <div
      className={`relative flex min-w-0 flex-col justify-center px-4 py-3 ${
        divided ? "border-l border-white/10" : ""
      }`}
    >
      <p className="truncate text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate text-[13px] font-black text-foreground" title={value}>
        {value}
      </p>
    </div>
  );
}

function TrustCard({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <Icon className="h-5 w-5 text-primary" />
      <p className="mt-3 text-sm font-black text-foreground">{title}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function ManualStep({ index, text }: { index: number; text: string }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border/50 bg-card/55 px-3 py-2.5">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-black text-primary">
        {index}
      </span>
      <span className="leading-relaxed">{text}</span>
    </li>
  );
}

function ActionMessage({
  status,
  message,
  compact,
  className,
}: {
  status: ActionStatus;
  message: string;
  compact?: boolean;
  className?: string;
}) {
  const failed = status === "failed";

  return (
    <p
      className={`${compact ? "text-[12px]" : "text-sm"} rounded-xl border px-3 py-2 font-semibold ${
        failed
          ? "border-destructive/20 bg-destructive/10 text-destructive"
          : "border-success/20 bg-success/10 text-success"
      } ${className ?? ""}`}
    >
      {message}
    </p>
  );
}
