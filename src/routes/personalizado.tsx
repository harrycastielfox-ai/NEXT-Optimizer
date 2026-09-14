import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  Terminal,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { SafeTestModeNotice } from "@/components/common/SafeTestModeNotice";
import { Sidebar } from "@/components/dashboard/Sidebar";
import {
  applyAdvancedActions,
  fallbackAdvancedCatalog,
  loadAdvancedCatalog,
  refreshAdvancedCatalog,
  type AdvancedAction,
  type AdvancedApplyResult,
  type AdvancedBlockedAction,
  type AdvancedCatalog,
  type AdvancedMethod,
  type AdvancedRisk,
} from "@/lib/advanced";
import { HERMES_SAFE_TEST_MODE } from "@/lib/safe-mode";

export const Route = createFileRoute("/personalizado")({
  head: () => ({
    meta: [
      { title: "NEXT Optimizer - Personalizado" },
      { name: "description", content: "Ações individuais seguras do NEXT Optimizer." },
    ],
  }),
  component: PersonalizadoPage,
});

function PersonalizadoPage() {
  const [catalog, setCatalog] = useState<AdvancedCatalog>(fallbackAdvancedCatalog);
  const [result, setResult] = useState<AdvancedApplyResult | null>(null);
  const [blockedResult, setBlockedResult] = useState<BlockedSelectionResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [blockedDialogAction, setBlockedDialogAction] = useState<AdvancedBlockedAction | null>(
    null,
  );
  const [workingRestartItems, setWorkingRestartItems] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        const nextCatalog = await loadAdvancedCatalog();
        if (!mounted) {
          return;
        }

        setCatalog(nextCatalog);
      })();
    }, 250);

    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, []);

  async function validateAllowedAction(action: AdvancedAction) {
    const userConfirmed =
      HERMES_SAFE_TEST_MODE ||
      window.confirm(
        `Preparar esta ação individual?\n\n${customPresentation(action).title}\n\nO NEXT usará apenas itens allowlistados, com snapshot/log quando aplicável.`,
      );

    if (!userConfirmed) {
      return;
    }

    setIsWorking(true);
    setError(null);
    setResult(null);
    setBlockedResult([]);
    setWorkingRestartItems(action.requiresRestart ? [customPresentation(action).title] : []);

    try {
      const nextResult = await applyAdvancedActions({
        confirmed: !HERMES_SAFE_TEST_MODE && userConfirmed,
        dryRun: HERMES_SAFE_TEST_MODE,
        actionIds: [action.id],
      });
      setResult(nextResult);

      setCatalog(await refreshAdvancedCatalog());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsWorking(false);
      setWorkingRestartItems([]);
    }
  }

  async function validateBlockedAction(action: AdvancedBlockedAction) {
    setIsWorking(true);
    setError(null);
    setResult(null);
    setBlockedResult([]);
    setWorkingRestartItems(blockedMayRequireRestart(action) ? [blockedTitle(action)] : []);

    try {
      setBlockedResult([
        {
          id: action.id,
          title: blockedTitle(action),
          message: blockedMayRequireRestart(action)
            ? "Preparado para validação segura. Esta opção pode exigir reinício quando for aplicada em fluxo real."
            : "Preparado para validação segura. O NEXT mantem a execução controlada e guiada.",
          requiresRestart: blockedMayRequireRestart(action),
        },
      ]);
      setCatalog(await refreshAdvancedCatalog());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsWorking(false);
      setWorkingRestartItems([]);
    }
  }

  return (
    <div className="lightning-bg min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 overflow-auto px-5 pt-6 pb-4 xl:px-8 xl:pt-7">
          <div className="mb-6">
            <p className="mb-2 text-xs font-bold tracking-[0.22em] text-primary">
              ACOES INDIVIDUAIS
            </p>
            <h1 className="text-[clamp(26px,2vw,34px)] font-bold leading-tight tracking-tight text-foreground">
              Personalizado
            </h1>
            <p className="mt-1 max-w-4xl text-[13px] leading-relaxed text-muted-foreground">
              Escolha uma ação específica da lista segura do NEXT. Esta é a única área para validar
              comandos individuais; comandos livres e recursos perigosos continuam protegidos.
            </p>
          </div>

          <SafeTestModeNotice />

          <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="text-sm font-bold tracking-[0.18em] text-primary">
                  ACOES PERMITIDAS
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Escolha uma ação e valide diretamente pelo proprio card. Em modo seguro, tudo roda
                  como dry-run.
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
              {catalog.actions.map((action) => (
                <CustomActionCard
                  key={action.id}
                  action={action}
                  busy={isWorking}
                  onValidate={() => void validateAllowedAction(action)}
                />
              ))}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <StatusBox label="Ações permitidas" value={`${catalog.actions.length}`} />
              <StatusBox
                label="Modo atual"
                value={HERMES_SAFE_TEST_MODE ? "Dry-run" : "Confirmacao"}
              />
              <StatusBox label="Comando livre" value="Fora da lista" />
            </div>

            {result && (
              <div className="mt-4 rounded-xl border border-success/20 bg-success/10 px-4 py-3">
                <p className="text-sm font-bold text-success">
                  {result.dryRun ? "Dry-run concluído" : "Validação concluída"}
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Ponto de segurança: {result.snapshotId}. {result.message}
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {result.appliedActions.map((item) => (
                    <div
                      key={`${item.id}-${item.status}`}
                      className="rounded-lg border border-success/20 bg-card/80 px-3 py-2"
                    >
                      <p className="text-[12px] font-bold text-foreground">{item.title}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{item.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {blockedResult.length > 0 && (
              <div className="mt-4 rounded-xl border border-warning/25 bg-warning/10 px-4 py-3">
                <p className="text-sm font-bold text-warning">Ações de nível alto preparadas</p>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Estes itens foram preparados com validação guiada. Em modo seguro, nenhuma mudanca
                  real e aplicada.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {blockedResult.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-warning/20 bg-card/80 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[12px] font-bold text-foreground">{item.title}</p>
                        {item.requiresRestart && (
                          <SmallPill text="Pode exigir reinício" tone="warning" />
                        )}
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{item.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
                {error}
              </div>
            )}
          </section>

          <section className="mt-4 rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-sm font-bold tracking-[0.18em] text-primary">
                  ACOES DE NÍVEL ALTO
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Opções individuais avançadas com explicacao, confirmação e validação guiada.
                </p>
              </div>
              <span className="inline-flex w-fit rounded-full border border-destructive/20 bg-destructive/10 px-3 py-1 text-[11px] font-bold text-destructive">
                Alto
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
              {catalog.blockedActions.map((action) => (
                <BlockedActionCard
                  key={action.id}
                  action={action}
                  busy={isWorking}
                  onValidate={() => setBlockedDialogAction(action)}
                />
              ))}
            </div>
          </section>
        </main>
      </div>

      {isWorking && <WorkingOverlay hasRestartWarning={workingRestartItems.length > 0} />}
      {blockedDialogAction && (
        <HighLevelActionDialog
          items={[blockedDialogAction]}
          restartItems={
            blockedMayRequireRestart(blockedDialogAction) ? [blockedTitle(blockedDialogAction)] : []
          }
          onCancel={() => setBlockedDialogAction(null)}
          onContinue={() => {
            const action = blockedDialogAction;
            setBlockedDialogAction(null);
            void validateBlockedAction(action);
          }}
        />
      )}
    </div>
  );
}

function CustomActionCard({
  action,
  busy,
  onValidate,
}: {
  action: AdvancedAction;
  busy: boolean;
  onValidate: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const presentation = customPresentation(action);

  return (
    <article className="flex flex-col rounded-2xl border border-border/70 bg-background/70 p-4 transition hover:border-primary/25 hover:bg-primary/5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <Terminal className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-foreground">{presentation.title}</h3>
            <Badge tone={action.risk}>{riskLabel(action.risk)}</Badge>
            {action.reversible && <SmallPill text="Reversivel" />}
            {!action.persistent && <SmallPill text="Temporario" />}
            {action.requiresAdmin && <SmallPill text="Admin" tone="warning" />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{presentation.description}</p>
          <p className="mt-2 text-[12px] font-semibold text-primary">{presentation.impact}</p>
        </div>
      </div>

      <TechnicalDetails open={showDetails} onToggle={() => setShowDetails((current) => !current)}>
        <TechnicalLine label="Titulo técnico" value={action.title} />
        <TechnicalLine label="Metodo" value={methodLabel(action.method)} />
        <TechnicalLine label="Valor atual" value={action.currentValue} />
        <TechnicalLine label="Mudanca planejada" value={action.plannedChange} />
        <TechnicalLine label="Preview" value={action.commandPreview} />
      </TechnicalDetails>

      <button
        type="button"
        onClick={onValidate}
        disabled={busy}
        className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_10px_26px_-14px_rgba(37,99,235,0.85)] transition hover:bg-primary/95 disabled:opacity-60"
      >
        <Terminal className="h-4 w-4" />
        {HERMES_SAFE_TEST_MODE ? "Validar em dry-run" : "Preparar ação"}
      </button>
    </article>
  );
}

function BlockedActionCard({
  action,
  busy,
  onValidate,
}: {
  action: AdvancedBlockedAction;
  busy: boolean;
  onValidate: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const mayRequireRestart = blockedMayRequireRestart(action);

  return (
    <div className="flex flex-col rounded-xl border border-border/70 bg-card px-3 py-3 transition hover:border-warning/35 hover:bg-warning/5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{blockedTitle(action)}</p>
            <BlockedRiskBadge />
            {mayRequireRestart && <SmallPill text="Pode exigir reinício" tone="warning" />}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">{highLevelDescription(action)}</p>
        </div>
      </div>
      <TechnicalDetails open={showDetails} onToggle={() => setShowDetails((current) => !current)}>
        <TechnicalLine label="Nome técnico" value={action.title} />
        <TechnicalLine label="Metodo" value={methodLabel(action.method)} />
        <TechnicalLine label="Exige admin" value={action.requiresAdmin ? "sim" : "não"} />
        <TechnicalLine label="Exige extremo" value={action.requiresExtreme ? "sim" : "não"} />
        <TechnicalLine label="Pode exigir reinício" value={mayRequireRestart ? "sim" : "não"} />
      </TechnicalDetails>

      <button
        type="button"
        onClick={onValidate}
        disabled={busy}
        className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_10px_26px_-14px_rgba(37,99,235,0.85)] transition hover:bg-primary/95 disabled:opacity-60"
      >
        <AlertTriangle className="h-4 w-4" />
        Entender e validar
      </button>
    </div>
  );
}

function WorkingOverlay({ hasRestartWarning }: { hasRestartWarning: boolean }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/20 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/80 bg-white/95 p-5 shadow-[0_24px_80px_-30px_rgba(15,23,42,0.45)]">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <SlidersHorizontal className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">Validando ação</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              O NEXT está preparando a análise da ação escolhida. Em modo seguro, nenhuma alteração
              real será aplicada.
            </p>
            {hasRestartWarning && (
              <p className="mt-2 text-[12px] font-semibold text-warning">
                Esta ação pode exigir reinício se for liberada no futuro.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function HighLevelActionDialog({
  items,
  restartItems,
  onCancel,
  onContinue,
}: {
  items: AdvancedBlockedAction[];
  restartItems: string[];
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/25 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-warning/25 bg-white p-5 shadow-[0_24px_80px_-30px_rgba(15,23,42,0.5)]">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-warning/10 text-warning">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-foreground">Confirmar ação de nível alto</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              O NEXT vai preparar esta ação com validação guiada. Antes de qualquer aplicação real,
              você sempre verá o que será feito, se precisa de admin, se pode exigir reinício e como
              acompanhar o resultado.
            </p>
            <div className="mt-3 rounded-xl border border-border/70 bg-background/70 p-3">
              {items.slice(0, 4).map((item) => (
                <div key={item.id} className="py-1">
                  <p className="text-[12px] font-bold text-foreground">{blockedTitle(item)}</p>
                  <p className="text-[11px] text-muted-foreground">{highLevelDescription(item)}</p>
                </div>
              ))}
              {items.length > 4 && (
                <p className="text-[12px] font-semibold text-muted-foreground">
                  + {items.length - 4} itens
                </p>
              )}
              {restartItems.length > 0 && (
                <p className="mt-2 rounded-lg border border-warning/20 bg-warning/10 px-3 py-2 text-[12px] font-semibold text-warning">
                  Algumas opções podem pedir reinício para concluir corretamente.
                </p>
              )}
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground transition hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={onContinue}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition hover:bg-primary/95"
              >
                Entendi, validar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

function TechnicalDetails({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-3 border-t border-border/70 pt-3">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1 text-[12px] font-bold text-primary transition hover:text-primary/80"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {open ? "Ocultar detalhes técnicos" : "Ver detalhes técnicos"}
      </button>
      {open && <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">{children}</div>}
    </div>
  );
}

function TechnicalLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card px-3 py-2">
      <p className="text-[10px] font-bold tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-[12px] font-semibold text-foreground">
        {value || "indisponível"}
      </p>
    </div>
  );
}

function Badge({ tone, children }: { tone: AdvancedRisk; children: ReactNode }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${riskTone(tone)}`}>
      {children}
    </span>
  );
}

function BlockedRiskBadge() {
  return (
    <span className="rounded-full border border-destructive/20 bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
      Alto
    </span>
  );
}

function SmallPill({ text, tone = "default" }: { text: string; tone?: "default" | "warning" }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${tone === "warning" ? "border-warning/25 bg-warning/10 text-warning" : "border-primary/20 bg-primary/10 text-primary"}`}
    >
      {text}
    </span>
  );
}

function customPresentation(action: AdvancedAction) {
  const map: Record<string, { title: string; description: string; impact: string }> = {
    "enable-game-mode": {
      title: "Modo Jogo do Windows",
      description: "Prepara o Windows para priorizar jogos quando você permitir.",
      impact: "Impacto: melhor foco em jogos. Reversível.",
    },
    "disable-game-dvr": {
      title: "Captura Xbox / Game DVR",
      description: "Reduz captura em segundo plano durante jogos.",
      impact: "Impacto: pode melhorar FPS e reduzir tarefas em segundo plano.",
    },
    "disable-startup-delay": {
      title: "Atraso de inicialização",
      description: "Reduz a espera antes de iniciar apps após login.",
      impact: "Impacto: login mais rápido. Reversível.",
    },
    "flush-dns-cache": {
      title: "Limpar cache DNS",
      description: "Atualiza o cache local de nomes de rede.",
      impact: "Impacto: pode resolver lentidão ou falha de navegação.",
    },
    "list-power-plans": {
      title: "Ver planos de energia",
      description: "Lista planos disponíveis sem alterar nada.",
      impact: "Impacto: somente leitura.",
    },
    "set-high-performance-power-plan": {
      title: "Plano de alto desempenho",
      description: "Prepara troca controlada para maior desempenho.",
      impact: "Impacto: mais desempenho com possível maior consumo.",
    },
    "disable-transparency": {
      title: "Transparencias do Windows",
      description: "Reduz um efeito visual opcional do Windows.",
      impact: "Impacto: menor custo visual. Opt-in.",
    },
    "disable-window-animations": {
      title: "Animacoes do Windows",
      description: "Reduz movimentos da interface quando você permitir.",
      impact: "Impacto: sensacao mais rápida. Reversível.",
    },
    "disable-visual-shadows": {
      title: "Sombras visuais",
      description: "Reduz sombras leves da interface.",
      impact: "Impacto: menor custo visual. Reversível.",
    },
    "set-visual-effects-custom": {
      title: "Efeitos visuais personalizados",
      description: "Marca efeitos visuais como personalizados com confirmação clara.",
      impact: "Impacto: organizacao dos ajustes visuais. Reversível.",
    },
  };

  return (
    map[action.id] ?? {
      title: action.title,
      description: action.description,
      impact: "Impacto: validado pela lista segura do NEXT.",
    }
  );
}

function blockedTitle(action: AdvancedBlockedAction) {
  const map: Record<string, string> = {
    "chkdsk-repair": "Reparo profundo do disco",
    "defrag-optimize": "Otimização automática de disco",
    "winsock-reset": "Reset completo de rede",
    "disable-windows-update": "Desativar atualizações",
    "disable-defender": "Desativar proteção",
    "delete-user-files": "Apagar arquivos pessoais",
    "remove-programs": "Remover programas",
    "free-registry-delete": "Registro livre",
    "hklm-multimedia-tweaks": "Tweaks profundos",
    "sfc-scan-now": "Verificador de arquivos",
    "dism-restore-health": "Reparo da imagem do Windows",
  };

  return map[action.id] ?? action.title;
}

function highLevelDescription(action: AdvancedBlockedAction) {
  const map: Record<string, string> = {
    "chkdsk-repair":
      "Verifica o disco em profundidade e pode agendar reparos para a próxima inicialização.",
    "defrag-optimize":
      "Analisa a otimização de disco considerando o tipo de unidade antes de qualquer ação.",
    "winsock-reset":
      "Prepara uma restauração de componentes de rede quando houver falhas persistentes de conexao.",
    "disable-windows-update":
      "Controla ajustes de atualização apenas em fluxo guiado, sem reduzir segurança de forma permanente.",
    "disable-defender":
      "Mantem a proteção do Windows sob controle explicito e com confirmação dedicada.",
    "delete-user-files":
      "Arquivos pessoais continuam fora das rotinas automáticas; qualquer ação manual precisa ser clara e isolada.",
    "remove-programs":
      "Programas não são removidos pelo NEXT; quando aplicável, apenas a inicialização pode ser gerenciada.",
    "free-registry-delete":
      "Chaves fora da lista segura exigem revisão técnica antes de qualquer alteração.",
    "hklm-multimedia-tweaks":
      "Ajustes profundos de desempenho exigem permissão elevada, backup e confirmação forte.",
    "sfc-scan-now":
      "Verifica arquivos do Windows em Reparar Windows com acompanhamento do resultado.",
    "dism-restore-health":
      "Repara a imagem do Windows em Reparar Windows quando houver indicio de corrupção.",
  };

  return map[action.id] ?? action.reason.replace(/^Bloqueado(?: nesta fase)?:\s*/i, "");
}

function blockedMayRequireRestart(action: AdvancedBlockedAction) {
  const text = `${action.id} ${action.title} ${action.reason}`.toLowerCase();
  return (
    text.includes("reinicio") || text.includes("reinício") || action.id === "dism-restore-health"
  );
}

function methodLabel(method: AdvancedMethod) {
  if (method === "cmd") {
    return "CMD";
  }

  if (method === "powerShell") {
    return "PowerShell";
  }

  return "Registro";
}

function riskLabel(risk: AdvancedRisk) {
  if (risk === "high") {
    return "Alto";
  }

  if (risk === "medium") {
    return "Médio";
  }

  return "Baixo";
}

function riskTone(risk: AdvancedRisk) {
  if (risk === "high") {
    return "border-destructive/20 bg-destructive/10 text-destructive";
  }

  if (risk === "medium") {
    return "border-warning/25 bg-warning/10 text-warning";
  }

  return "border-success/20 bg-success/10 text-success";
}

type BlockedSelectionResult = {
  id: string;
  title: string;
  message: string;
  requiresRestart: boolean;
};
