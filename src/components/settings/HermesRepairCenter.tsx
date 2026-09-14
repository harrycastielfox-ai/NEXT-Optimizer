import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  Clock3,
  FileSearch,
  History,
  ListChecks,
  LockKeyhole,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  fallbackDiagnosticReport,
  loadDiagnosticReport,
  refreshDiagnosticReport,
  type DiagnosticReport,
} from "@/lib/diagnostic";
import { createRestoreSnapshot, type RestoreSnapshot } from "@/lib/restore";

type RepairActionId = "sfc-scannow" | "dism-scanhealth" | "dism-restorehealth";
type RepairSelection = "diagnostic" | "protections" | "history" | RepairActionId;
type RepairHistoryStatus = "checked" | "prepared" | "blocked" | "failed";

type RepairHistoryEntry = {
  id: string;
  timestamp: string;
  action: string;
  result: string;
  status: RepairHistoryStatus;
  snapshotId?: string;
};

type RepairAction = {
  id: RepairActionId;
  title: string;
  command: string;
  description: string;
  risk: "medium" | "high";
  estimatedTime: string;
  requiresAdmin: boolean;
  notes: string[];
};

type ProtectedRepairAction = {
  id: string;
  title: string;
  description: string;
  reason: string;
  guidance: string;
  mayRequireRestart?: boolean;
};

const HISTORY_KEY = "hermes.repair.history.v1";
const MAX_HISTORY = 20;

const repairActions: RepairAction[] = [
  {
    id: "sfc-scannow",
    title: "Verificador de Arquivos",
    command: "sfc /scannow",
    description:
      "Verifica arquivos protegidos do Windows e prepara reparo estrutural quando necessário.",
    risk: "medium",
    estimatedTime: "10 a 30 min",
    requiresAdmin: true,
    notes: [
      "Pode consumir CPU e disco durante a verificação.",
      "Não deve ser interrompido após iniciado em fase futura.",
      "Nesta fase o NEXT apenas prepara snapshot, log e histórico.",
    ],
  },
  {
    id: "dism-scanhealth",
    title: "Imagem do Windows",
    command: "DISM /Online /Cleanup-Image /ScanHealth",
    description: "Analisa a imagem do Windows para detectar corrupção sem aplicar reparo.",
    risk: "medium",
    estimatedTime: "5 a 20 min",
    requiresAdmin: true,
    notes: [
      "Leitura pesada, preparada para execução confirmada futura.",
      "Não altera a imagem do sistema nesta etapa visual.",
      "Resultado futuro deve ser registrado no histórico local.",
    ],
  },
  {
    id: "dism-restorehealth",
    title: "Restaurar Imagem",
    command: "DISM /Online /Cleanup-Image /RestoreHealth",
    description: "Prepara reparo da imagem do Windows quando uma corrupção for confirmada.",
    risk: "high",
    estimatedTime: "20 a 60 min",
    requiresAdmin: true,
    notes: [
      "Pode depender de fontes locais ou Windows Update em fase futura.",
      "Sempre exigirá confirmação forte antes de executar.",
      "Não e executado automaticamente pelo NEXT.",
    ],
  },
];

const protectedRepairActions: ProtectedRepairAction[] = [
  {
    id: "chkdsk-repair",
    title: "chkdsk /f /r automático",
    description: "Reparo profundo de disco.",
    reason: "Pode demorar bastante, exigir reinício e travar o volume durante a verificação.",
    guidance:
      "O NEXT deixa esse reparo em fluxo dedicado, com explicacao, confirmação forte e recomendação de backup antes de qualquer execução futura.",
    mayRequireRestart: true,
  },
  {
    id: "winsock-reset",
    title: "winsock reset automático",
    description: "Reinicializacao de componentes de rede.",
    reason: "Pode afetar conectividade e geralmente pede reinício para concluir.",
    guidance:
      "Quando fizer sentido, deve aparecer como reparo de rede guiado, explicando o impacto antes da confirmação.",
    mayRequireRestart: true,
  },
  {
    id: "network-reset",
    title: "reset de rede automático",
    description: "Reset amplo de adaptadores e configurações de rede.",
    reason: "Pode desconectar redes salvas, VPNs e adaptadores até a próxima configuração.",
    guidance: "O NEXT deve tratar isso como reparo avançado, nunca como otimização rápida.",
    mayRequireRestart: true,
  },
  {
    id: "windows-reset",
    title: "reset do Windows",
    description: "Reinstalacao/restauração ampla do sistema.",
    reason: "E uma ação estrutural do Windows e pode afetar aplicativos e configurações.",
    guidance:
      "Fica fora do NEXT automático. O app pode orientar o usuário, mas não deve disparar esse fluxo sozinho.",
  },
];

export function HermesRepairCenter() {
  const [diagnostic, setDiagnostic] = useState<DiagnosticReport>(fallbackDiagnosticReport);
  const [history, setHistory] = useState<RepairHistoryEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [preparingId, setPreparingId] = useState<RepairActionId | null>(null);
  const [selectedSection, setSelectedSection] = useState<RepairSelection>("diagnostic");

  useEffect(() => {
    setHistory(readHistory());
    void runHermesDiagnostic(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const integrity = useMemo(() => buildIntegrityStatus(diagnostic), [diagnostic]);
  const latestHistory = history[0];
  const selectedRepairAction =
    repairActions.find((action) => action.id === selectedSection) ?? null;

  async function runHermesDiagnostic(recordHistory = true) {
    setIsChecking(true);
    setNotice(null);
    setError(null);

    try {
      const nextDiagnostic = recordHistory
        ? await refreshDiagnosticReport()
        : await loadDiagnosticReport();
      setDiagnostic(nextDiagnostic);

      if (recordHistory) {
        const snapshot = await createRepairSnapshot({
          title: "Diagnóstico NEXT",
          description:
            "Snapshot local para auditoria antes do diagnóstico de reparo somente leitura.",
          command: "diagnostic_engine_read",
          risk: "low",
        });
        const entry = buildHistoryEntry({
          action: "Diagnóstico NEXT",
          result: `Diagnóstico concluído: ${nextDiagnostic.healthLabel}, Defender ${nextDiagnostic.defender.status}, Windows Update ${nextDiagnostic.windowsUpdate.status}.`,
          status: "checked",
          snapshotId: snapshot?.id,
        });
        commitHistory(entry);
        setNotice(
          snapshot
            ? `Diagnóstico registrado com snapshot ${snapshot.id}.`
            : "Diagnóstico registrado localmente. Snapshot real exige Tauri.",
        );
      }
    } catch (nextError) {
      const message = errorMessage(nextError);
      setError(message);
      commitHistory(
        buildHistoryEntry({
          action: "Diagnóstico NEXT",
          result: message,
          status: "failed",
        }),
      );
    } finally {
      setIsChecking(false);
    }
  }

  async function prepareRepair(action: RepairAction) {
    const confirmed = window.confirm(
      `Preparar ${action.title}?\n\nComando futuro: ${action.command}\nTempo estimado: ${action.estimatedTime}\nRisco: ${riskLabel(action.risk)}\n\nNesta fase o NEXT NÃO executará o comando. Será criado snapshot/log/histórico quando possível.`,
    );
    if (!confirmed) {
      return;
    }

    setPreparingId(action.id);
    setNotice(null);
    setError(null);

    try {
      const snapshot = await createRepairSnapshot({
        title: action.title,
        description: action.description,
        command: action.command,
        risk: action.risk,
      });
      const result = snapshot
        ? `Ação preparada com snapshot ${snapshot.id}. Comando não executado.`
        : "Ação preparada em histórico local. Snapshot real exige Tauri.";

      commitHistory(
        buildHistoryEntry({
          action: action.title,
          result,
          status: "prepared",
          snapshotId: snapshot?.id,
        }),
      );
      setNotice(result);
    } catch (nextError) {
      const message = errorMessage(nextError);
      setError(message);
      commitHistory(
        buildHistoryEntry({
          action: action.title,
          result: message,
          status: "failed",
        }),
      );
    } finally {
      setPreparingId(null);
    }
  }

  function registerBlockedAction(action: string) {
    const entry = buildHistoryEntry({
      action,
      result: "Bloqueado por politica NEXT: reparo destrutivo ou pesado sem executor seguro.",
      status: "blocked",
    });
    commitHistory(entry);
    setNotice(`${action} permanece bloqueado nesta fase.`);
  }

  function commitHistory(entry: RepairHistoryEntry) {
    setHistory((current) => {
      const next = [entry, ...current].slice(0, MAX_HISTORY);
      saveHistory(next);
      return next;
    });
  }

  return (
    <section id="centro-reparo" className="scroll-mt-5 mt-4 space-y-4">
      {notice && <Notice tone="success" text={notice} />}
      {error && <Notice tone="danger" text={error} />}

      <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_34px_-20px_rgba(15,23,42,0.16)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-bold tracking-[0.22em] text-primary">PLANO DE REPARO</p>
            <h2 className="mt-1 text-xl font-bold text-foreground">Escolha uma verificação</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              O NEXT organiza reparos por etapas. Selecione um card para ver apenas o detalhe
              necessário.
            </p>
          </div>
          <button
            type="button"
            onClick={() => runHermesDiagnostic(true)}
            disabled={isChecking}
            className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_10px_26px_-14px_rgba(37,99,235,0.85)] transition hover:bg-primary/95 disabled:opacity-60"
          >
            <RefreshCcw className={`h-4 w-4 ${isChecking ? "animate-spin" : ""}`} />
            Verificar diagnóstico
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <RepairModeCard
            icon={Stethoscope}
            eyebrow="ANALISE"
            title="Diagnóstico"
            description={`${diagnostic.healthLabel} - score ${Math.round(diagnostic.healthScore)}/100`}
            selected={selectedSection === "diagnostic"}
            onClick={() => setSelectedSection("diagnostic")}
            badge="Leitura"
          />
          {repairActions.map((action) => (
            <RepairModeCard
              key={action.id}
              icon={TerminalSquare}
              eyebrow={action.risk === "high" ? "REPARO" : "VERIFICACAO"}
              title={action.title}
              description={action.estimatedTime}
              selected={selectedSection === action.id}
              onClick={() => setSelectedSection(action.id)}
              badge={riskLabel(action.risk)}
              tone={action.risk === "high" ? "danger" : "warning"}
            />
          ))}
          <RepairModeCard
            icon={LockKeyhole}
            eyebrow="PROTECAO"
            title="Proteções Ativas"
            description={`${protectedRepairActions.length} reparos exigem fluxo dedicado`}
            selected={selectedSection === "protections"}
            onClick={() => setSelectedSection("protections")}
            badge="Obrigatorio"
            tone="warning"
          />
          <RepairModeCard
            icon={History}
            eyebrow="AUDITORIA"
            title="Histórico"
            description={`${history.length} registros locais`}
            selected={selectedSection === "history"}
            onClick={() => setSelectedSection("history")}
            badge="Local"
          />
        </div>
      </section>

      {selectedRepairAction ? (
        <RepairActionDetail
          action={selectedRepairAction}
          busy={preparingId === selectedRepairAction.id}
          onPrepare={() => prepareRepair(selectedRepairAction)}
        />
      ) : selectedSection === "protections" ? (
        <RepairProtectionsPanel
          actions={protectedRepairActions}
          onProtectedAction={registerBlockedAction}
        />
      ) : selectedSection === "history" ? (
        <RepairHistoryPanel history={history} />
      ) : (
        <DiagnosticPanel
          diagnostic={diagnostic}
          integrity={integrity}
          latestHistory={latestHistory}
        />
      )}
    </section>
  );
}

function RepairProtectionsPanel({
  actions,
  onProtectedAction,
}: {
  actions: ProtectedRepairAction[];
  onProtectedAction: (action: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_34px_-20px_rgba(15,23,42,0.16)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-warning/10 text-warning">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-[0.22em] text-primary">PROTECOES ATIVAS</p>
            <h3 className="mt-1 text-xl font-bold text-foreground">
              Reparos que exigem cuidado extra
            </h3>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Estas funções existem no NEXT como proteção obrigatória: elas não entram em otimização
              automática e só devem avançar em fluxo dedicado.
            </p>
          </div>
        </div>
        <span className="w-fit rounded-full border border-warning/25 bg-warning/10 px-3 py-1 text-[11px] font-bold text-warning">
          Execução automática protegida
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        {actions.map((action) => (
          <ProtectedRepairCard
            key={action.id}
            action={action}
            onProtectedAction={onProtectedAction}
          />
        ))}
      </div>
    </section>
  );
}

function ProtectedRepairCard({
  action,
  onProtectedAction,
}: {
  action: ProtectedRepairAction;
  onProtectedAction: (action: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-warning/20 bg-warning/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-bold text-foreground">{action.title}</h4>
              <span className="rounded-full border border-destructive/20 bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
                Alto
              </span>
              {action.mayRequireRestart && (
                <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[10px] font-bold text-warning">
                  Pode exigir reinício
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px] font-semibold text-muted-foreground">
              {action.description}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-background/55 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Por que exige cuidado
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{action.reason}</p>
        </div>
        <div className="rounded-xl border border-primary/15 bg-primary/5 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
            Como o NEXT trata
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {action.guidance}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onProtectedAction(action.title)}
        className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_10px_26px_-16px_rgba(37,99,235,0.85)] transition hover:bg-primary/95"
      >
        <ShieldCheck className="h-4 w-4" />
        Registrar proteção
      </button>
    </div>
  );
}

function RepairModeCard({
  icon: Icon,
  eyebrow,
  title,
  description,
  badge,
  selected,
  onClick,
  tone = "primary",
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  badge: string;
  selected: boolean;
  onClick: () => void;
  tone?: "primary" | "warning" | "danger";
}) {
  const badgeClass =
    tone === "danger"
      ? "border-destructive/20 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-warning/25 bg-warning/10 text-warning"
        : "border-primary/20 bg-primary/10 text-primary";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[150px] rounded-2xl border p-4 text-left transition ${
        selected
          ? "border-primary bg-primary/5 shadow-[0_18px_42px_-30px_rgba(37,99,235,0.65)] ring-1 ring-primary/20"
          : "border-border/70 bg-background/70 hover:-translate-y-0.5 hover:border-primary/25 hover:bg-primary/5"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${badgeClass}`}>
          {badge}
        </span>
      </div>
      <p className="mt-3 text-[11px] font-bold tracking-[0.18em] text-primary">{eyebrow}</p>
      <h3 className="mt-1 text-base font-bold leading-tight text-foreground">{title}</h3>
      <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
        {description}
      </p>
    </button>
  );
}

function RepairActionDetail({
  action,
  busy,
  onPrepare,
}: {
  action: RepairAction;
  busy: boolean;
  onPrepare: () => void;
}) {
  const cta =
    action.id === "dism-restorehealth"
      ? "Preparar reparo"
      : action.id === "dism-scanhealth"
        ? "Preparar analise"
        : "Preparar verificação";

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_34px_-20px_rgba(15,23,42,0.16)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <TerminalSquare className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-[0.22em] text-primary">ACAO SELECIONADA</p>
            <h3 className="mt-1 text-xl font-bold text-foreground">{action.title}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {action.description}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onPrepare}
          disabled={busy}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_10px_26px_-14px_rgba(37,99,235,0.85)] transition hover:bg-primary/95 disabled:opacity-60 sm:w-fit"
        >
          <LockKeyhole className="h-4 w-4" />
          {busy ? "Preparando" : cta}
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <MiniFact label="Nível" value={riskLabel(action.risk)} />
        <MiniFact label="Tempo" value={action.estimatedTime} />
        <MiniFact label="Admin" value={action.requiresAdmin ? "Obrigatorio" : "Não"} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div className="rounded-2xl border border-primary/10 bg-primary/5 p-4">
          <p className="text-[11px] font-bold tracking-[0.18em] text-primary">
            COMO O NEXT PROTEGE
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {action.notes.slice(0, 3).map((note) => (
              <div
                key={note}
                className="flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{note}</span>
              </div>
            ))}
          </div>
        </div>

        <details className="rounded-2xl border border-border/70 bg-background/70 p-4 text-[12px]">
          <summary className="cursor-pointer select-none font-bold text-primary">
            Ver detalhe técnico
          </summary>
          <code className="mt-3 block break-words rounded-xl bg-muted px-3 py-3 font-semibold text-muted-foreground">
            {action.command}
          </code>
        </details>
      </div>
    </section>
  );
}

function DiagnosticPanel({
  diagnostic,
  integrity,
  latestHistory,
}: {
  diagnostic: DiagnosticReport;
  integrity: {
    label: string;
    description: string;
    tone: "primary" | "success" | "warning" | "danger";
  };
  latestHistory?: RepairHistoryEntry;
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_34px_-20px_rgba(15,23,42,0.16)]">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Stethoscope className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-[0.22em] text-primary">DIAGNOSTICO NEXT</p>
          <h3 className="mt-1 text-xl font-bold text-foreground">Resumo de integridade</h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Leitura local para orientar reparo sem executar comandos pesados.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-4">
        <StatusCard
          icon={ShieldCheck}
          label="ESTADO GERAL"
          value={integrity.label}
          sub={integrity.description}
          tone={integrity.tone}
        />
        <StatusCard
          icon={Clock3}
          label="ULTIMA VERIFICACAO"
          value={latestHistory ? formatDate(latestHistory.timestamp) : "Não registrada"}
          sub={latestHistory?.action ?? "Aguardando diagnóstico NEXT"}
        />
        <StatusCard
          icon={FileSearch}
          label="ULTIMA ANALISE"
          value={diagnostic.healthLabel}
          sub={`Score ${Math.round(diagnostic.healthScore)}/100`}
        />
        <StatusCard
          icon={ShieldAlert}
          label="INTEGRIDADE"
          value={repairReadiness(diagnostic)}
          sub="Baseado em diagnóstico local existente"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-3">
        <DiagnosticCheck
          icon={RefreshCcw}
          title="Windows Update"
          value={diagnostic.windowsUpdate.status}
          description={`${diagnostic.windowsUpdate.serviceStatus} - ${diagnostic.windowsUpdate.lastHotfixId}`}
          tone={
            diagnostic.windowsUpdate.status.toLowerCase().includes("dia") ? "success" : "warning"
          }
        />
        <DiagnosticCheck
          icon={ShieldCheck}
          title="Defender"
          value={diagnostic.defender.status}
          description={
            diagnostic.defender.active ? "Proteção ativa no diagnóstico." : "Revisão recomendada."
          }
          tone={diagnostic.defender.active ? "success" : "danger"}
        />
        <DiagnosticCheck
          icon={ListChecks}
          title="Alertas locais"
          value={diagnostic.warnings.length > 0 ? "Atencao" : "Sem alertas"}
          description={
            diagnostic.warnings[0] ?? "Nenhum aviso crítico retornado pela Diagnostic Engine."
          }
          tone={diagnostic.warnings.length > 0 ? "warning" : "success"}
        />
      </div>
    </section>
  );
}

function RepairHistoryPanel({ history }: { history: RepairHistoryEntry[] }) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_34px_-20px_rgba(15,23,42,0.16)]">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <History className="h-6 w-6" />
        </div>
        <div>
          <p className="text-[11px] font-bold tracking-[0.22em] text-primary">HISTORICO</p>
          <h3 className="mt-1 text-xl font-bold text-foreground">Últimas preparações</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Snapshots, validacoes e bloqueios ficam registrados localmente.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
        {history.length > 0 ? (
          history.slice(0, 8).map((entry) => <HistoryRow key={entry.id} entry={entry} />)
        ) : (
          <EmptyState
            icon={History}
            title="Sem histórico ainda"
            sub="Preparacoes, diagnosticos e bloqueios aparecerão aqui."
          />
        )}
      </div>
    </section>
  );
}

function StatusCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "primary",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  tone?: "primary" | "success" | "warning" | "danger";
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneClass(tone)}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-wider text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-bold leading-tight text-foreground">{value}</p>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{sub}</p>
    </div>
  );
}

function DiagnosticCheck({
  icon: Icon,
  title,
  value,
  description,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  description: string;
  tone: "primary" | "success" | "warning" | "danger";
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-3">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${toneClass(tone)}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">{title}</p>
          <p className="mt-0.5 text-sm font-semibold text-primary">{value}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ entry }: { entry: RepairHistoryEntry }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-[0_10px_30px_-28px_rgba(15,23,42,0.45)]">
      <span className={`absolute left-0 top-0 h-full w-1 ${historyAccentClass(entry.status)}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-muted-foreground">
            {formatDate(entry.timestamp)}
          </p>
          <p className="mt-1 text-sm font-bold text-foreground">{entry.action}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {historyDisplayResult(entry)}
          </p>
          {entry.snapshotId && (
            <p className="mt-2 w-fit max-w-full truncate rounded-lg border border-primary/10 bg-primary/5 px-2 py-1 text-[11px] font-semibold text-primary">
              Snapshot: {shortSnapshot(entry.snapshotId)}
            </p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusPillClass(entry.status)}`}
        >
          {statusLabel(entry.status)}
        </span>
      </div>
    </div>
  );
}

function Notice({ tone, text }: { tone: "success" | "danger"; text: string }) {
  return (
    <div
      className={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${tone === "success" ? "border-success/20 bg-success/10 text-success" : "border-destructive/20 bg-destructive/10 text-destructive"}`}
    >
      {text}
    </div>
  );
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/70 px-2 py-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-[12px] font-bold text-foreground">{value}</p>
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

async function createRepairSnapshot({
  title,
  description,
  command,
  risk,
}: {
  title: string;
  description: string;
  command: string;
  risk: "low" | "medium" | "high";
}): Promise<RestoreSnapshot | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  return await createRestoreSnapshot({
    name: `Reparar Windows - ${title}`,
    description,
    plannedActions: [
      {
        id: `repair-${Date.now()}`,
        engine: "NEXT Repair Center",
        title,
        description: `${description} Comando preparado: ${command}.`,
        risk,
        willModifySystem: false,
        requiresAdmin: command !== "diagnostic_engine_read",
      },
    ],
    rollbackManifest: [],
    previousState: [
      {
        key: "repairCommand",
        category: "metadata",
        value: command,
        source: "NEXT Repair Center",
        captured: true,
      },
    ],
  });
}

function buildIntegrityStatus(report: DiagnosticReport): {
  label: string;
  description: string;
  tone: "primary" | "success" | "warning" | "danger";
} {
  if (!report.defender.active) {
    return {
      label: "Atencao",
      description: "Defender inativo ou indisponível no diagnóstico.",
      tone: "warning",
    };
  }

  if (report.warnings.length > 0 || report.healthScore < 70) {
    return {
      label: "Revisar",
      description: report.warnings[0] ?? "Score geral abaixo do ideal.",
      tone: "warning",
    };
  }

  return {
    label: "Saudavel",
    description: "Sem alertas críticos nas engines de leitura atuais.",
    tone: "success",
  };
}

function repairReadiness(report: DiagnosticReport) {
  if (report.warnings.length > 0 || !report.defender.active) {
    return "Revisar";
  }

  return "Preparado";
}

function buildHistoryEntry({
  action,
  result,
  status,
  snapshotId,
}: {
  action: string;
  result: string;
  status: RepairHistoryStatus;
  snapshotId?: string;
}): RepairHistoryEntry {
  return {
    id: `repair-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    action,
    result,
    status,
    snapshotId,
  };
}

function readHistory(): RepairHistoryEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as RepairHistoryEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
  } catch (error) {
    console.warn("Falha ao ler histórico local de reparos.", error);
    return [];
  }
}

function saveHistory(history: RepairHistoryEntry[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
}

function toneClass(tone: "primary" | "success" | "warning" | "danger") {
  if (tone === "success") return "bg-success/10 text-success";
  if (tone === "warning") return "bg-warning/10 text-warning";
  if (tone === "danger") return "bg-destructive/10 text-destructive";
  return "bg-primary-soft text-primary";
}

function statusPillClass(status: RepairHistoryStatus) {
  if (status === "checked") return "border-success/20 bg-success/10 text-success";
  if (status === "prepared") return "border-primary/20 bg-primary/10 text-primary";
  if (status === "blocked") return "border-warning/25 bg-warning/10 text-warning";
  return "border-destructive/20 bg-destructive/10 text-destructive";
}

function historyAccentClass(status: RepairHistoryStatus) {
  if (status === "checked") return "bg-success";
  if (status === "prepared") return "bg-primary";
  if (status === "blocked") return "bg-warning";
  return "bg-destructive";
}

function statusLabel(status: RepairHistoryStatus) {
  if (status === "checked") return "Verificado";
  if (status === "prepared") return "Preparado";
  if (status === "blocked") return "Bloqueado";
  return "Falha";
}

function riskLabel(risk: RepairAction["risk"] | "low") {
  if (risk === "high") return "Alto";
  if (risk === "medium") return "Médio";
  return "Baixo";
}

function shortSnapshot(snapshotId: string) {
  if (snapshotId.length <= 24) {
    return snapshotId;
  }

  return `${snapshotId.slice(0, 18)}...${snapshotId.slice(-6)}`;
}

function historyDisplayResult(entry: RepairHistoryEntry) {
  if (entry.snapshotId) {
    return entry.result.replace(entry.snapshotId, "snapshot de segurança");
  }

  return entry.result;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Indisponível";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
