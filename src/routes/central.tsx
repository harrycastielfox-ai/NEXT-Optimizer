import { createFileRoute, redirect } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  BrushCleaning,
  CheckCircle2,
  Cpu,
  FileText,
  Gamepad2,
  Gauge,
  HardDrive,
  Layers3,
  LockKeyhole,
  MonitorCog,
  Power,
  RefreshCcw,
  ShieldCheck,
  Stethoscope,
  Terminal,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SafeTestModeNotice } from "@/components/common/SafeTestModeNotice";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { HERMES_SAFE_TEST_MODE } from "@/lib/safe-mode";

type RouteTo =
  | "/"
  | "/diagnostico"
  | "/inicializacao"
  | "/otimizacoes"
  | "/limpeza"
  | "/perfis"
  | "/seguranca"
  | "/reparar-windows"
  | "/personalizado"
  | "/configuracoes";

type ActionRisk = "Baixo" | "Médio" | "Alto" | "Extremo";

type ActionBadge = "Leitura" | "Dry-run" | "Reversivel" | "Confirmacao" | "Admin";

type OptimizationLevelId = "seguro" | "limpeza" | "performance" | "gamer" | "avancado";
type RecommendationContextId = "system" | "startup" | "gamer" | "visual" | "network" | "advanced";

type OptimizationAction = {
  title: string;
  description: string;
  icon: LucideIcon;
  to: RouteTo;
  risk: ActionRisk;
  badges: ActionBadge[];
};

type OptimizationLevel = {
  id: OptimizationLevelId;
  eyebrow: string;
  title: string;
  summary: string;
  detail: string;
  icon: LucideIcon;
  tone: "safe" | "clean" | "performance" | "gamer" | "advanced";
  risk: ActionRisk;
  guarantees: string[];
  technicalDetails?: string[];
  actions: OptimizationAction[];
};

const levels: OptimizationLevel[] = [
  {
    id: "seguro",
    eyebrow: "NÍVEL 1",
    title: "Seguro",
    summary: "Analisa e recomenda sem mudar o Windows.",
    detail: "Entenda o estado do PC antes de qualquer ajuste.",
    icon: ShieldCheck,
    tone: "safe",
    risk: "Baixo",
    guarantees: [
      "Somente leitura.",
      "Simulacao ativa.",
      "Sem alterar Windows.",
      "Ideal como primeiro passo.",
    ],
    actions: [
      {
        title: "Analisar PC",
        description: "Prepara um plano local sem modificar o sistema.",
        icon: Stethoscope,
        to: "/",
        risk: "Baixo",
        badges: ["Leitura", "Dry-run"],
      },
      {
        title: "Diagnóstico",
        description: "CPU, RAM, disco, GPU e status do Windows.",
        icon: Cpu,
        to: "/diagnostico",
        risk: "Baixo",
        badges: ["Leitura"],
      },
      {
        title: "Benchmark",
        description: "Score leve para comparar antes e depois.",
        icon: BarChart3,
        to: "/diagnostico",
        risk: "Baixo",
        badges: ["Leitura"],
      },
      {
        title: "NEXT Insight",
        description: "Score local e plano recomendado.",
        icon: BrainCircuit,
        to: "/configuracoes",
        risk: "Baixo",
        badges: ["Leitura"],
      },
      {
        title: "Relatório",
        description: "Resumo local do estado do PC.",
        icon: FileText,
        to: "/configuracoes",
        risk: "Baixo",
        badges: ["Leitura"],
      },
    ],
  },
  {
    id: "limpeza",
    eyebrow: "NÍVEL 2",
    title: "Limpeza",
    summary: "Temporários, cache, logs e quarentena.",
    detail: "Limpeza segura por lista segura, sempre com confirmação.",
    icon: BrushCleaning,
    tone: "clean",
    risk: "Baixo",
    guarantees: [
      "Analisa antes.",
      "Confirmação obrigatória.",
      "Quarentena quando aplicável.",
      "Não toca arquivos pessoais.",
    ],
    actions: [
      {
        title: "Clean Scan",
        description: "Calcula cache e temporários sem apagar nada.",
        icon: BrushCleaning,
        to: "/limpeza",
        risk: "Baixo",
        badges: ["Leitura", "Dry-run"],
      },
      {
        title: "Limpeza segura",
        description: "Mostra tudo antes de limpar.",
        icon: BrushCleaning,
        to: "/limpeza",
        risk: "Baixo",
        badges: ["Dry-run", "Confirmacao", "Reversivel"],
      },
      {
        title: "Temporários e cache",
        description: "TEMP, cache, miniaturas e logs permitidos.",
        icon: HardDrive,
        to: "/limpeza",
        risk: "Baixo",
        badges: ["Dry-run", "Confirmacao"],
      },
      {
        title: "Quarentena",
        description: "Recuperacao antes da expiracao.",
        icon: RefreshCcw,
        to: "/limpeza",
        risk: "Médio",
        badges: ["Reversivel", "Confirmacao"],
      },
    ],
  },
  {
    id: "performance",
    eyebrow: "NÍVEL 3",
    title: "Performance",
    summary: "Energia, inicialização e Modo Jogo seguro.",
    detail: "Performance reversível sem mexer em tema ou navegadores.",
    icon: Gauge,
    tone: "performance",
    risk: "Médio",
    guarantees: [
      "Ponto de segurança quando preciso.",
      "Reversao quando suportada.",
      "Não altera tema.",
      "Nunca remove programas.",
    ],
    actions: [
      {
        title: "Plano de energia",
        description: "Troca controlada com reversão.",
        icon: Power,
        to: "/otimizacoes",
        risk: "Médio",
        badges: ["Dry-run", "Reversivel", "Confirmacao"],
      },
      {
        title: "Inicialização",
        description: "Desativa ou reativa sem remover.",
        icon: Zap,
        to: "/inicializacao",
        risk: "Médio",
        badges: ["Dry-run", "Reversivel", "Confirmacao"],
      },
      {
        title: "Modo Jogo",
        description: "Ajuste reversível e seguro para jogos.",
        icon: Gamepad2,
        to: "/otimizacoes",
        risk: "Médio",
        badges: ["Dry-run", "Reversivel"],
      },
      {
        title: "Performance segura",
        description: "Fluxo protegido, histórico local e bloqueios.",
        icon: MonitorCog,
        to: "/otimizacoes",
        risk: "Médio",
        badges: ["Dry-run", "Confirmacao"],
      },
    ],
  },
  {
    id: "gamer",
    eyebrow: "NÍVEL 4",
    title: "Gamer",
    summary: "Jogos, overlays e restauração pos-jogo.",
    detail: "Prepara o PC para jogar sem fechar nada sozinho.",
    icon: Gamepad2,
    tone: "gamer",
    risk: "Médio",
    guarantees: [
      "Nada fecha sozinho.",
      "Processos críticos protegidos.",
      "Reversao pos-jogo.",
      "Overlays apenas sugeridos.",
    ],
    actions: [
      {
        title: "Preparação para jogos",
        description: "Fluxo Gamer em modo seguro.",
        icon: Gamepad2,
        to: "/perfis",
        risk: "Médio",
        badges: ["Dry-run", "Reversivel", "Confirmacao"],
      },
      {
        title: "Overlays e launchers",
        description: "Detecta e sugere, sem fechar sozinho.",
        icon: Layers3,
        to: "/perfis",
        risk: "Médio",
        badges: ["Dry-run", "Confirmacao"],
      },
      {
        title: "Restauração pos-jogo",
        description: "Prepara retorno ao estado anterior.",
        icon: RefreshCcw,
        to: "/perfis",
        risk: "Médio",
        badges: ["Dry-run", "Reversivel"],
      },
    ],
  },
  {
    id: "avancado",
    eyebrow: "NÍVEL 5",
    title: "Avançado",
    summary: "Automações avançadas e reparo forte.",
    detail: "Recursos poderosos com aviso forte e confirmação reforcada.",
    icon: Terminal,
    tone: "advanced",
    risk: "Extremo",
    guarantees: [
      "Comando livre bloqueado.",
      "Lista segura obrigatória.",
      "Confirmação forte.",
      "Estado Base recomendado.",
    ],
    technicalDetails: [
      "HKCU: leituras e alterações somente em chaves permitidas.",
      "VisualFXSetting: deve ter captura e reversão antes de ajuste visual.",
      "StartupDelayInMSec: usado apenas por ação allowlistada e reversível.",
      "GameConfigStore: usado para Game Mode/Game DVR quando permitido.",
      "PowerShell/CMD: sem comando livre digitado pelo usuário.",
      "SFC/DISM: preparado apenas para reparo avançado com confirmação forte.",
    ],
    actions: [
      {
        title: "Motor avançado",
        description: "Somente ações permitidas pela lista segura.",
        icon: Terminal,
        to: "/personalizado",
        risk: "Alto",
        badges: ["Dry-run", "Confirmacao", "Admin"],
      },
      {
        title: "Automações do Windows",
        description: "Ajustes permitidos em componentes avancados.",
        icon: LockKeyhole,
        to: "/personalizado",
        risk: "Alto",
        badges: ["Dry-run", "Reversivel", "Admin"],
      },
      {
        title: "Reparo avançado",
        description: "Verificação profunda do Windows com confirmação forte.",
        icon: AlertTriangle,
        to: "/reparar-windows",
        risk: "Extremo",
        badges: ["Dry-run", "Confirmacao", "Admin"],
      },
    ],
  },
];

const recommendationContextMap: Record<
  RecommendationContextId,
  {
    title: string;
    summary: string;
    levelId: OptimizationLevelId;
  }
> = {
  system: {
    title: "Desempenho do Sistema",
    summary:
      "Recomendação criada a partir do plano de energia e dos ajustes de performance detectados.",
    levelId: "performance",
  },
  startup: {
    title: "Inicialização",
    summary: "Recomendação para revisar o que afeta o tempo de boot sem remover programas.",
    levelId: "performance",
  },
  gamer: {
    title: "Experiência Gamer",
    summary: "Recomendação para preparar jogos, overlays e restauração pos-jogo com confirmação.",
    levelId: "gamer",
  },
  visual: {
    title: "Efeitos Visuais",
    summary:
      "Recomendação para ajustes visuais opcionais sem alterar tema do Windows ou navegadores.",
    levelId: "performance",
  },
  network: {
    title: "Rede/DNS",
    summary: "Recomendação para validar ações temporárias de rede apenas quando fizer sentido.",
    levelId: "avancado",
  },
  advanced: {
    title: "Avançado",
    summary: "Recomendação para olhar automações técnicas em área guiada e com confirmação forte.",
    levelId: "avancado",
  },
};

export const Route = createFileRoute("/central")({
  beforeLoad: () => {
    throw redirect({ to: "/otimizar" });
  },
  validateSearch: (
    search: Record<string, unknown>,
  ): { nivel?: OptimizationLevelId; recomendacao?: RecommendationContextId } => {
    const nivel =
      typeof search.nivel === "string" && isOptimizationLevelId(search.nivel)
        ? search.nivel
        : undefined;
    const recomendacao =
      typeof search.recomendacao === "string" && isRecommendationContextId(search.recomendacao)
        ? search.recomendacao
        : undefined;
    return { nivel, recomendacao };
  },
  head: () => ({
    meta: [
      { title: "NEXT Optimizer - Central de Otimização" },
      { name: "description", content: "Central de Otimização por níveis do NEXT Optimizer." },
    ],
  }),
  component: CentralPage,
});

function CentralPage() {
  const search = Route.useSearch();
  const [selectedId, setSelectedId] = useState<OptimizationLevelId>(search.nivel ?? levels[0].id);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedLevel = useMemo(
    () => levels.find((level) => level.id === selectedId) ?? levels[0],
    [selectedId],
  );
  const selectedBundle = useMemo(() => buildLevelBundle(selectedLevel), [selectedLevel]);
  const recommendationContext = search.recomendacao
    ? recommendationContextMap[search.recomendacao]
    : null;

  useEffect(() => {
    if (search.nivel) {
      setSelectedId(search.nivel);
      setNotice(null);
    }
  }, [search.nivel]);

  function handleValidate() {
    setNotice(
      `${selectedLevel.title}: pacote seguro validado em dry-run. Nenhuma alteração real foi aplicada.`,
    );
  }

  return (
    <div className="lightning-bg min-h-screen flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 overflow-auto px-5 pt-6 pb-4 xl:px-8 xl:pt-7">
          <div className="mb-5">
            <div className="max-w-4xl">
              <p className="mb-2 text-xs font-bold tracking-[0.22em] text-primary">
                CENTRAL DE OTIMIZACAO
              </p>
              <h1 className="text-[clamp(28px,2.4vw,38px)] font-bold leading-tight tracking-tight text-foreground">
                Ações do NEXT organizadas por nível
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                Cada nível inclui os anteriores. Escolha até onde o NEXT deve preparar o fluxo,
                sempre em SAFE_TEST_MODE nesta etapa.
              </p>
            </div>
          </div>

          <SafeTestModeNotice />

          {notice && (
            <div className="mb-4 rounded-xl border border-success/20 bg-success/10 px-4 py-3 text-sm font-semibold text-success">
              {notice}
            </div>
          )}

          {recommendationContext && (
            <RecommendationContextPanel
              context={recommendationContext}
              selectedLevel={selectedLevel}
              onSelectRecommended={() => {
                setSelectedId(recommendationContext.levelId);
                setNotice(null);
              }}
            />
          )}

          <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            {levels.map((level) => (
              <LevelSelectCard
                key={level.id}
                level={level}
                selected={level.id === selectedLevel.id}
                onSelect={() => {
                  setSelectedId(level.id);
                  setNotice(null);
                }}
              />
            ))}
          </section>

          <SelectedLevelPanel
            key={selectedLevel.id}
            bundle={selectedBundle}
            onValidate={handleValidate}
          />
        </main>
      </div>
    </div>
  );
}

function RecommendationContextPanel({
  context,
  selectedLevel,
  onSelectRecommended,
}: {
  context: (typeof recommendationContextMap)[RecommendationContextId];
  selectedLevel: OptimizationLevel;
  onSelectRecommended: () => void;
}) {
  const recommendedLevel = levels.find((level) => level.id === context.levelId) ?? levels[0];
  const isRecommendedLevel = selectedLevel.id === recommendedLevel.id;

  return (
    <section className="mb-4 rounded-2xl border border-primary/25 bg-blue-50/55 p-4 shadow-[0_16px_44px_-32px_rgba(37,99,235,0.75),0_0_0_1px_rgba(37,99,235,0.08)_inset]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.22em] text-primary">
            RECOMENDACAO RECEBIDA
          </p>
          <h2 className="mt-1 text-lg font-bold text-foreground">{context.title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {context.summary} Você pode olhar o nível recomendado ou trocar para outro nível pelos
            cards abaixo.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <ContextStat label="Nível recomendado" value={recommendedLevel.title} />
            <ContextStat label="Nível aberto" value={selectedLevel.title} />
            <ContextStat label="Modo" value={HERMES_SAFE_TEST_MODE ? "Dry-run" : "Confirmacao"} />
          </div>
        </div>

        {!isRecommendedLevel && (
          <button
            type="button"
            onClick={onSelectRecommended}
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_10px_26px_-14px_rgba(37,99,235,0.85)] transition hover:bg-primary/95"
          >
            Voltar ao recomendado
          </button>
        )}
      </div>
    </section>
  );
}

function ContextStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-primary/10 bg-white/70 px-3 py-2">
      <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-[12px] font-bold text-foreground">{value}</p>
    </div>
  );
}

function LevelSelectCard({
  level,
  selected,
  onSelect,
}: {
  level: OptimizationLevel;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = level.icon;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`min-h-[126px] rounded-2xl border bg-card p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_30px_-22px_rgba(15,23,42,0.2)] transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/5 ${
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/25 shadow-[0_16px_42px_-30px_rgba(37,99,235,0.95)]"
          : "border-border/60"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${levelTone(level.tone)}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.18em] text-primary">{level.eyebrow}</p>
          <h2 className="mt-1 text-sm font-bold leading-tight text-foreground">{level.title}</h2>
          <p className="mt-1 text-[11px] font-semibold text-muted-foreground">
            {riskDisplay(level.risk)}
          </p>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
        {level.summary}
      </p>
    </button>
  );
}

type LevelBundle = {
  level: OptimizationLevel;
  includedLevels: OptimizationLevel[];
  actions: OptimizationAction[];
  guarantees: string[];
};

function buildLevelBundle(level: OptimizationLevel): LevelBundle {
  const selectedIndex = levels.findIndex((candidate) => candidate.id === level.id);
  const includedLevels = levels.slice(0, selectedIndex >= 0 ? selectedIndex + 1 : 1);

  return {
    level,
    includedLevels,
    actions: includedLevels.flatMap((includedLevel) => includedLevel.actions),
    guarantees: Array.from(
      new Set(includedLevels.flatMap((includedLevel) => includedLevel.guarantees)),
    ),
  };
}

function SelectedLevelPanel({
  bundle,
  onValidate,
}: {
  bundle: LevelBundle;
  onValidate: () => void;
}) {
  const { level } = bundle;
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const Icon = level.icon;
  const includedNames = bundle.includedLevels
    .map((includedLevel) => includedLevel.title)
    .join(" + ");
  const hasTechnicalDetails = level.id === "avancado" && Boolean(level.technicalDetails?.length);

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_34px_-22px_rgba(15,23,42,0.16)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div
            className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${levelTone(level.tone)}`}
          >
            <Icon className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-foreground">{level.title}</h2>
              <span
                className={`rounded-full border px-3 py-1 text-[11px] font-bold ${riskTone(level.risk)}`}
              >
                {riskDisplay(level.risk)}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success/10 px-3 py-1 text-[11px] font-bold text-success">
                <RefreshCcw className="h-3.5 w-3.5" />
                Reversível
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{level.detail}</p>
            <p className="mt-1 text-[12px] font-semibold text-primary">Inclui: {includedNames}</p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {bundle.guarantees.slice(0, 5).map((item) => (
                <InfoPill key={item} icon={ShieldCheck} text={item} />
              ))}
            </div>
          </div>
        </div>

        <div className="flex shrink-0">
          <button
            type="button"
            onClick={onValidate}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground shadow-[0_10px_26px_-14px_rgba(37,99,235,0.85)] transition hover:bg-primary/95"
          >
            <Zap className="h-4 w-4" />
            {HERMES_SAFE_TEST_MODE ? "Validar seguro" : "Aplicar seguro"}
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <DetailBox title="ACOES">
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {bundle.actions.map((action) => (
              <ActionCard key={`${level.id}-${action.title}`} action={action} />
            ))}
          </div>
        </DetailBox>

        <DetailBox title="GARANTIAS">
          <div className="space-y-2">
            {bundle.guarantees.map((item) => (
              <GuaranteeRow key={item} text={item} />
            ))}
            {(level.id === "performance" || level.id === "gamer" || level.id === "avancado") && (
              <WarningBox text="Performance e Gamer não alteram tema do Windows, modo claro/escuro ou navegadores automaticamente." />
            )}
            {level.id === "avancado" && (
              <WarningBox text="Recursos avançados usam lista segura, confirmação forte, ponto de segurança e reversão quando o modo real for liberado." />
            )}
            {hasTechnicalDetails && (
              <div className="mt-3 rounded-xl border border-border/70 bg-card px-3 py-3">
                <button
                  type="button"
                  onClick={() => setShowTechnicalDetails((current) => !current)}
                  className="text-[12px] font-bold text-primary transition hover:text-primary/80"
                >
                  {showTechnicalDetails ? "Ocultar detalhes técnicos" : "Ver detalhes técnicos"}
                </button>
                {showTechnicalDetails && (
                  <div className="mt-3 space-y-2">
                    {level.technicalDetails?.map((detail) => (
                      <div
                        key={detail}
                        className="rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-[11px] font-semibold text-muted-foreground"
                      >
                        {detail}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </DetailBox>
      </div>
    </section>
  );
}

function ActionCard({ action }: { action: OptimizationAction }) {
  const Icon = action.icon;

  return (
    <div className="rounded-xl border border-border/70 bg-card px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-foreground">{action.title}</h3>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${riskTone(action.risk)}`}
            >
              {riskDisplay(action.risk)}
            </span>
          </div>
          <p className="mt-1 line-clamp-1 text-[11px] leading-relaxed text-muted-foreground">
            {action.description}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {action.badges.map((badge) => (
              <ActionBadgePill key={badge} badge={badge} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
      <h3 className="mb-3 text-[11px] font-bold tracking-[0.22em] text-primary">{title}</h3>
      {children}
    </div>
  );
}

function InfoPill({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex min-h-9 items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <span className="text-[11px] font-semibold leading-snug text-foreground">{text}</span>
    </div>
  );
}

function GuaranteeRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 text-sm text-foreground">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>{text}</span>
    </div>
  );
}

function WarningBox({ text }: { text: string }) {
  return (
    <div className="mt-3 rounded-xl border border-warning/25 bg-warning/10 px-3 py-3 text-[12px] font-semibold leading-relaxed text-warning">
      {text}
    </div>
  );
}

function ActionBadgePill({ badge }: { badge: ActionBadge }) {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
      {badge}
    </span>
  );
}

function levelTone(tone: OptimizationLevel["tone"]) {
  switch (tone) {
    case "safe":
      return "bg-success/10 text-success";
    case "clean":
      return "bg-primary-soft text-primary";
    case "performance":
      return "bg-blue-50 text-blue-600";
    case "gamer":
      return "bg-purple-50 text-purple-600";
    case "advanced":
      return "bg-warning/10 text-warning";
  }
}

function riskDisplay(risk: ActionRisk) {
  return risk;
}

function riskTone(risk: ActionRisk) {
  switch (risk) {
    case "Baixo":
      return "border-success/20 bg-success/10 text-success";
    case "Médio":
      return "border-warning/20 bg-warning/10 text-warning";
    case "Alto":
      return "border-orange-200 bg-orange-50 text-orange-700";
    case "Extremo":
      return "border-destructive/20 bg-destructive/10 text-destructive";
  }
}

function isOptimizationLevelId(value: string): value is OptimizationLevelId {
  return levels.some((level) => level.id === value);
}

function isRecommendationContextId(value: string): value is RecommendationContextId {
  return Object.prototype.hasOwnProperty.call(recommendationContextMap, value);
}
