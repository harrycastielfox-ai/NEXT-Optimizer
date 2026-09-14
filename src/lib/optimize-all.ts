import { refreshAdvisorAiReport, type AdvisorAiReport } from "@/lib/advisor-ai";
import {
  applyOptimizeNowCleanEngine,
  refreshCleanScanReport,
  type CleanApplyResult,
  type CleanScanReport,
} from "@/lib/clean";
import { refreshDiagnosticReport, type DiagnosticReport } from "@/lib/diagnostic";
import {
  applyGamerEngine,
  loadGamerReport,
  type GamerApplyResult,
  type GamerGameProfile,
  type GamerProcess,
  type GamerReport,
} from "@/lib/gamer";
import { runOptimizeNowPlan, type OptimizeNowPlan } from "@/lib/optimizer";
import {
  applyPerformanceControlled,
  refreshPerformanceReport,
  type PerformanceApplyResult,
  type PerformanceReport,
} from "@/lib/performance";
import { HERMES_SAFE_TEST_MODE } from "@/lib/safe-mode";
import {
  applyStartupEngine,
  refreshStartupReport,
  type StartupApplyResult,
  type StartupReport,
} from "@/lib/startup";
import {
  applyOptimizeNowAdvancedActions,
  applyOptimizeNowGraphicsPreference,
  formatAdvancedActionSummary,
  refreshAdvancedCatalog,
  type AdvancedApplyResult,
  type AdvancedCatalog,
} from "@/lib/advanced";
import {
  buildGamerDependencyReadiness,
  gamerDependencyPreparationIssues,
  prepareAndInstallVerifiedGamerDependencies,
  type GamerDependencyDownloadResult,
  type GamerDependencyInstallResult,
  type GamerDependencyReadiness,
  type GamerDependencyVerificationReport,
  verifyGamerDependencyInstallers,
} from "@/lib/gamer-dependencies";

export type OptimizeAllPhaseId =
  | "plan"
  | "safety"
  | "components"
  | "cleanup"
  | "startup"
  | "performance"
  | "gamer"
  | "profile"
  | "manual";

export type OptimizeAllReports = {
  diagnostic?: DiagnosticReport;
  clean?: CleanScanReport;
  cleanResult?: CleanApplyResult;
  startup?: StartupReport;
  startupResult?: StartupApplyResult;
  performance?: PerformanceReport;
  performanceResult?: PerformanceApplyResult;
  gamer?: GamerReport;
  gamerResult?: GamerApplyResult;
  advisor?: AdvisorAiReport;
  plan?: OptimizeNowPlan;
  advanced?: AdvancedCatalog;
  advancedResult?: AdvancedApplyResult;
  gamerFocusAdvanced?: AdvancedCatalog;
  gamerFocusAdvancedResult?: AdvancedApplyResult;
  gamerGraphicsPreferenceResult?: AdvancedApplyResult;
  gamerDependencies?: GamerDependencyReadiness;
  gamerDependencyVerification?: GamerDependencyVerificationReport;
  gamerDependencyDownloadResult?: GamerDependencyDownloadResult;
  gamerDependencyInstallResult?: GamerDependencyInstallResult;
};

export type OptimizeAllGameTarget = {
  id: string;
  label: string;
  detail: string;
  source: "active" | "detected" | "profile" | "preset";
  confidence: "high" | "medium" | "low";
  pid?: number;
  executable?: string;
  profileId?: string;
  engineHint?: string;
};

export type OptimizeAllPhaseResult = {
  outputs: string[];
  reports?: Partial<OptimizeAllReports>;
  gameTargets?: OptimizeAllGameTarget[];
};

export const HERMES_PREPARE_ADVANCED_ACTION_IDS = [
  "enable-game-mode",
  "disable-game-dvr",
  "disable-xbox-game-bar-deep",
  "set-visual-effects-gamer-minimal",
  "disable-hibernation",
  "disable-startup-delay",
  "disable-advertising-id",
  "disable-tailored-experiences",
  "disable-consumer-features",
  "disable-activity-history",
  "disable-location-tracking",
  "disable-recall-user",
  "flush-dns-cache",
  "dism-analyze-component-store",
  "dism-start-component-cleanup",
  "dism-check-netfx3",
  "dism-check-directplay",
  "check-gamer-dependencies",
  "set-diagtrack-service-manual",
  "set-mapsbroker-service-manual",
] as const;

const HERMES_COMPONENT_CMD_ACTION_IDS = [
  "dism-analyze-component-store",
  "dism-start-component-cleanup",
  "dism-check-netfx3",
  "dism-check-directplay",
  "dism-enable-directplay",
] as const;

const HERMES_OPTIMIZE_ADVANCED_ACTION_IDS = [
  ...HERMES_PREPARE_ADVANCED_ACTION_IDS,
  "dism-enable-directplay",
  "winsock-reset",
  "reset-ip-stack",
  "set-network-autotuning-normal",
  "disable-network-ecn",
  "enable-network-rss",
  "disable-background-apps",
  "disable-notification-toasts",
  "set-focus-assist-gamer",
  "set-high-performance-power-plan",
  "set-display-timeout-never",
  "set-windows-dark-mode",
  "disable-usb-selective-suspend",
  "disable-pcie-link-state-power-management",
  "check-timer-resolution-policy",
  "set-mmcss-gamer-pack",
  "set-fate-trigger-cpu-priority-high",
  "disable-storage-sense-auto-cleanup",
  "set-boot-timeout-fast",
  "set-wersvc-service-manual",
  "set-wmpnetworksvc-service-manual",
  "set-fax-service-manual",
  "set-retaildemo-service-manual",
  "set-phonesvc-service-manual",
  "set-walletservice-manual",
  "set-xbl-auth-manager-manual",
  "set-xbl-game-save-manual",
  "set-xbox-net-api-svc-manual",
] as const;

const HERMES_GAMER_FOCUS_ACTION_IDS = [
  "set-focus-assist-gamer",
  "set-mmcss-gamer-pack",
  "set-fate-trigger-cpu-priority-high",
] as const;

export async function runOptimizeAllPhase(
  phaseId: OptimizeAllPhaseId,
): Promise<OptimizeAllPhaseResult> {
  if (phaseId === "plan") {
    return runPlanPhase();
  }

  if (phaseId === "safety") {
    return {
      outputs: [
        HERMES_SAFE_TEST_MODE ? "Modo atual: teste bloqueado" : "Modo atual: real liberado",
        "Engines reais conectadas por fase",
        "Sem telemetria, nuvem ou processo residente",
      ],
    };
  }

  if (phaseId === "components") {
    return runComponentsPhase();
  }

  if (phaseId === "cleanup") {
    return runCleanupPhase();
  }

  if (phaseId === "startup") {
    return runStartupPhase();
  }

  if (phaseId === "performance") {
    return runPerformancePhase();
  }

  if (phaseId === "gamer") {
    return runGamerPhase();
  }

  if (phaseId === "profile") {
    return runProfilePhase();
  }

  return runAdvancedPhase();
}

async function runPlanPhase(): Promise<OptimizeAllPhaseResult> {
  const [plan, advisor, diagnostic] = await Promise.all([
    runOptimizeNowPlan(),
    refreshAdvisorAiReport(),
    refreshDiagnosticReport(),
  ]);

  return {
    reports: { plan, advisor, diagnostic },
    outputs: [
      `${plan.summary.totalStages} etapa(s) do orquestrador local`,
      `${advisor.recommendations.length} recomendação(ões) da NEXT Insight`,
      `Saúde atual: ${Math.round(diagnostic.healthScore)}/100`,
    ],
  };
}

async function runCleanupPhase(): Promise<OptimizeAllPhaseResult> {
  const clean = await refreshCleanScanReport();
  const selectedIds = clean.items
    .filter((item) => item.selectedByDefault && item.safeToCleanLater)
    .map((item) => item.id);

  const result = await tryRun(() =>
    selectedIds.length
      ? applyOptimizeNowCleanEngine({
          confirmed: shouldConfirmReal(),
          dryRun: shouldDryRun(),
          itemIds: selectedIds,
        })
      : Promise.resolve(null),
  );

  return {
    reports: {
      clean,
      cleanResult: result.value ?? undefined,
    },
    outputs: [
      `${formatGb(clean.totalGb)} GB candidatos para revisao`,
      `${clean.items.length} area(s) mapeada(s)`,
      result.value
        ? `${result.value.plannedEntries} item(ns) ${appliedVerb(result.value.dryRun)} pela Clean Engine`
        : (result.message ?? "Sem item seguro selecionado para validacao"),
    ],
  };
}

async function runStartupPhase(): Promise<OptimizeAllPhaseResult> {
  const startup = await refreshStartupReport();
  const itemIds = startup.items
    .filter(
      (item) =>
        item.status === "active" &&
        item.impact === "high" &&
        item.controllable &&
        item.canDisableLater,
    )
    .map((item) => item.id);

  const result = await tryRun(() =>
    itemIds.length
      ? applyStartupEngine({
          confirmed: shouldConfirmReal(),
          dryRun: shouldDryRun(),
          action: "disable",
          itemIds,
        })
      : Promise.resolve(null),
  );

  return {
    reports: {
      startup,
      startupResult: result.value ?? undefined,
    },
    outputs: [
      `${startup.totalItems} item(ns) de inicialização`,
      `${startup.highImpactCount} alto impacto`,
      `${startup.startupFolderItems} item(ns) na pasta Startup`,
      `${startup.scheduledTaskItems} tarefa(s) agendada(s) de logon/boot`,
      `${
        startup.onedriveItems + startup.teamsItems + startup.launcherItems + startup.updaterItems
      } item(ns) conhecidos: OneDrive, Teams, launchers e updaters`,
      startup.bootAgeMinutes === undefined
        ? "Boot baseline indisponível"
        : `Boot atual: ${formatBootAge(startup.bootAgeMinutes)}`,
      startup.postRebootRecent
        ? "Validação pós-reinício: recente"
        : startup.postRebootValidationAvailable
          ? "Validação pós-reinício: disponível"
          : "Validação pós-reinício: indisponível",
      result.value
        ? `${result.value.selectedItems} item(ns) ${appliedVerb(result.value.dryRun)} pela Startup Engine`
        : (result.message ?? "Sem item de alto impacto controlável agora"),
    ],
  };
}

async function runComponentsPhase(): Promise<OptimizeAllPhaseResult> {
  const advanced = await refreshAdvancedCatalog();
  const gamerDependencyPreparedResult = await tryRun(() =>
    prepareAndInstallVerifiedGamerDependencies({
      confirmed: shouldConfirmReal(),
      dryRun: shouldDryRun(),
    }),
  );
  const gamerDependencyVerification =
    gamerDependencyPreparedResult.value?.report ?? (await verifyGamerDependencyInstallers());
  const finalGamerDependencyVerification =
    gamerDependencyPreparedResult.value?.report ?? gamerDependencyVerification;
  if (!HERMES_SAFE_TEST_MODE && !gamerDependencyPreparedResult.value) {
    throw new Error(
      gamerDependencyPreparedResult.message ??
        "Não foi possível preparar as dependências gamer em modo real.",
    );
  }
  if (gamerDependencyPreparedResult.value) {
    const dependencyIssues = gamerDependencyPreparationIssues(gamerDependencyPreparedResult.value);
    if (!HERMES_SAFE_TEST_MODE && dependencyIssues.length > 0) {
      throw new Error(`Dependências gamer incompletas: ${dependencyIssues.join("; ")}.`);
    }
  }
  const gamerDependencies = buildGamerDependencyReadiness(
    advanced,
    finalGamerDependencyVerification,
  );
  const availableIds = new Set(advanced.actions.map((action) => action.id));
  const actionIds = HERMES_COMPONENT_CMD_ACTION_IDS.filter((id) => availableIds.has(id));
  const result = await tryRun(() =>
    actionIds.length
      ? applyOptimizeNowAdvancedActions({
          confirmed: shouldConfirmReal(),
          dryRun: shouldDryRun(),
          actionIds,
          extremeMode: false,
        })
      : Promise.resolve(null),
  );

  return {
    reports: {
      advanced,
      advancedResult: result.value ?? undefined,
      gamerDependencies,
      gamerDependencyVerification: finalGamerDependencyVerification,
      gamerDependencyDownloadResult: gamerDependencyPreparedResult.value?.downloadResult,
      gamerDependencyInstallResult: gamerDependencyPreparedResult.value?.installResult,
    },
    outputs: [
      `${actionIds.length} comando(s) CMD/DISM mapeados`,
      "Windows Update Component Cleanup, NetFx3 e DirectPlay entram no plano",
      gamerDependencyPreparedResult.value
        ? `${gamerDependencyPreparedResult.value.downloadResult.downloadedCount} baixado(s), ${gamerDependencyPreparedResult.value.downloadResult.skippedCount} pulado(s), ${gamerDependencyPreparedResult.value.downloadResult.failedCount} falha(s) no cache oficial`
        : `${gamerDependencyVerification.readyCount}/${gamerDependencyVerification.totalPackages} dependência(s) VC++/DirectX prontas; ${gamerDependencyVerification.installedLocallyCount} já instalada(s)`,
      gamerDependencyPreparedResult.value
        ? gamerDependencyPreparedResult.value.installResult.message
        : (gamerDependencyPreparedResult.message ??
          "Dependências gamer aguardando aplicativo Tauri"),
      `${gamerDependencies.installPlan.approvedPackages}/${gamerDependencies.installPlan.totalPackages} dependência(s) com manifesto oficial aprovado`,
      `${gamerDependencies.excludedToolchain.length} item(ns) de toolchain pesada ficam fora do pacote gamer`,
      result.value
        ? `${formatAdvancedActionSummary(result.value)} nos comandos CMD/DISM`
        : (result.message ?? "Componentes ainda não disponíveis neste PC"),
    ],
  };
}

async function runPerformancePhase(): Promise<OptimizeAllPhaseResult> {
  const performance = await refreshPerformanceReport();
  const actionIds = pickPerformanceActionIds(performance);
  const result = await tryRun(() =>
    actionIds.length
      ? applyPerformanceControlled({
          confirmed: shouldConfirmReal(),
          dryRun: shouldDryRun(),
          actionIds,
          reason: "Otimizar Tudo",
        })
      : Promise.resolve(null),
  );

  return {
    reports: {
      performance,
      performanceResult: result.value ?? undefined,
    },
    outputs: [
      `Plano atual: ${performance.powerPlan.activeSchemeName}`,
      `Modo Jogo: ${performance.gameMode.status}`,
      result.value
        ? `${result.value.appliedActions.length} ajuste(s) ${appliedVerb(result.value.dryRun)} pela Performance Engine`
        : (result.message ?? "Sem ajuste controlado disponível agora"),
    ],
  };
}

async function runGamerPhase(): Promise<OptimizeAllPhaseResult> {
  const gamer = await loadGamerReport();
  const gameTargets = buildGameTargets(gamer);
  const target = pickGlobalGamerTarget(gameTargets);
  const processIds = gamer.suggestedProcesses
    .filter((process) => process.canClose && process.recommendation === "suggestedClose")
    .map((process) => process.pid);
  const shouldValidate = processIds.length > 0 || gamer.activeGame.detected || Boolean(target);
  const result = await tryRun(() =>
    shouldValidate
      ? applyGamerEngine({
          confirmed: shouldConfirmReal(),
          dryRun: shouldDryRun(),
          processIds,
          includePerformanceProfile: true,
          gameProfileId: target?.profileId,
        })
      : Promise.resolve(null),
  );
  const focusPackage = await runGamerFocusPackage(target);

  return {
    reports: {
      gamer,
      gamerResult: result.value ?? undefined,
      gamerFocusAdvanced: focusPackage.advanced,
      gamerFocusAdvancedResult: focusPackage.advancedResult,
      gamerGraphicsPreferenceResult: focusPackage.graphicsPreferenceResult,
    },
    gameTargets,
    outputs: [
      ...focusPackage.outputs,
      target
        ? `Prioridade gamer global: ${target.label}`
        : "Prioridade gamer global aplicada sem jogo aberto",
      `${gamer.summary.detectedGames} jogo(s) detectado(s)`,
      `${gamer.summary.overlayCount} overlay(s) revisado(s); Steam/Xbox/GPU: ${gamer.summary.steamOverlayCount}/${gamer.summary.xboxOverlayCount}/${gamer.summary.gpuOverlayCount}`,
      `${gamer.summary.streamingExceptionCount + gamer.summary.emulatorExceptionCount} excecao(oes) protegida(s): OBS/BlueStacks/WSL`,
      `${gamer.summary.protectedCount} processo(s) protegido(s), incluindo Steam/Discord quando detectados`,
      result.value?.priorityResult
        ? `Prioridade do jogo: ${result.value.priorityResult.status}`
        : "Prioridade do jogo aguardando deteccao",
      result.value
        ? `${result.value.closedProcesses.length} processo(s) ${result.value.dryRun ? "validados" : "fechados"} pela Gamer Engine`
        : (result.message ?? "Pacote gamer global validado sem jogo aberto"),
    ],
  };
}

function pickGlobalGamerTarget(targets: OptimizeAllGameTarget[]) {
  return (
    targets.find((target) => target.id === "preset-fate-trigger-ue5") ??
    targets.find((target) => target.source === "active") ??
    targets[0]
  );
}

async function runGamerFocusPackage(target?: OptimizeAllGameTarget) {
  const advanced = await refreshAdvancedCatalog();
  const availableIds = new Set(
    advanced.actions
      .filter((action) => !action.requiresExtreme && action.risk !== "high")
      .map((action) => action.id),
  );
  const actionIds = HERMES_GAMER_FOCUS_ACTION_IDS.filter((id) => availableIds.has(id));
  const advancedResult = await tryRun(() =>
    actionIds.length
      ? applyOptimizeNowAdvancedActions({
          confirmed: shouldConfirmReal(),
          dryRun: shouldDryRun(),
          actionIds,
          extremeMode: false,
        })
      : Promise.resolve(null),
  );
  const fateGraphicsExecutable = shouldApplyFateGraphicsPreference(target)
    ? target?.executable
    : undefined;
  const graphicsPreferenceResult = await tryRun(() =>
    fateGraphicsExecutable
      ? applyOptimizeNowGraphicsPreference(fateGraphicsExecutable, shouldDryRun())
      : Promise.resolve(null),
  );

  const outputs = [
    actionIds.length
      ? `Pacote Fate/UE5: ${actionIds.length} ajuste(s) MMCSS/CPU mapeados`
      : "Pacote Fate/UE5 indisponível neste catálogo",
    advancedResult.value
      ? `${formatAdvancedActionSummary(advancedResult.value)} no foco gamer`
      : (advancedResult.message ?? "Pacote de foco aguardando motor avançado"),
  ];

  if (shouldApplyFateGraphicsPreference(target)) {
    outputs.push(
      graphicsPreferenceResult.value
        ? "GPU alto desempenho validada para o executável Fate Trigger detectado"
        : (graphicsPreferenceResult.message ?? "GPU alto desempenho aguardando validação"),
    );
  } else if (target && isFateTriggerTarget(target)) {
    outputs.push("GPU alto desempenho será ativada quando o caminho real da Steam for detectado");
  }

  return {
    advanced,
    advancedResult: advancedResult.value,
    graphicsPreferenceResult: graphicsPreferenceResult.value,
    outputs,
  };
}

async function runProfilePhase(): Promise<OptimizeAllPhaseResult> {
  return {
    outputs: [
      "Consolidacao global validada",
      "Sem perfil favorito, sem escolha manual e sem persistir preferencia de perfil",
      "Performance, limpeza, inicializacao, Gamer/Fate Trigger e Advanced Engine seguem no mesmo fluxo",
      HERMES_SAFE_TEST_MODE
        ? "Nenhuma alteracao real aplicada"
        : "Plano global aplicado no modo real",
    ],
  };
}
async function runAdvancedPhase(): Promise<OptimizeAllPhaseResult> {
  const advanced = await refreshAdvancedCatalog();
  const availableIds = new Set(
    advanced.actions
      .filter((action) => !action.requiresExtreme && action.risk !== "high")
      .map((action) => action.id),
  );
  const actionIds = HERMES_OPTIMIZE_ADVANCED_ACTION_IDS.filter((id) => availableIds.has(id));
  const result = await tryRun(() =>
    actionIds.length
      ? applyOptimizeNowAdvancedActions({
          confirmed: shouldConfirmReal(),
          dryRun: shouldDryRun(),
          actionIds,
          extremeMode: false,
        })
      : Promise.resolve(null),
  );

  return {
    reports: {
      advanced,
      advancedResult: result.value ?? undefined,
    },
    outputs: [
      `${advanced.actions.length} ação(ões) avançadas mapeadas`,
      `${advanced.blockedActions.length} ação(ões) bloqueadas por critério`,
      result.value
        ? `${formatAdvancedActionSummary(result.value)} pela Advanced Engine`
        : (result.message ?? "Sem comando avançado liberado para validação"),
    ],
  };
}

function shouldDryRun() {
  return HERMES_SAFE_TEST_MODE;
}

function shouldConfirmReal() {
  return !HERMES_SAFE_TEST_MODE;
}

function appliedVerb(dryRun: boolean) {
  return dryRun ? "validados" : "aplicados";
}

function pickPerformanceActionIds(report: PerformanceReport): string[] {
  const ids = report.settings
    .filter((item) => item.canOptimizeLater)
    .map((item) => performanceSettingToActionId(item.id))
    .filter((item): item is string => Boolean(item));

  if (ids.length > 0) {
    return [...new Set(ids)].slice(0, 5);
  }

  return ["set-high-performance-power-plan"];
}

function performanceSettingToActionId(settingId: string): string | undefined {
  if (settingId === "power-plan") {
    return "set-high-performance-power-plan";
  }
  if (settingId === "transparency") return "disable-transparency";
  if (settingId === "animations") return "disable-window-animations";
  if (settingId === "shadows") return "disable-visual-shadows";
  return undefined;
}

function buildGameTargets(report: GamerReport): OptimizeAllGameTarget[] {
  const targets: OptimizeAllGameTarget[] = [];

  if (report.activeGame.detected) {
    targets.push({
      id: `active-${report.activeGame.pid ?? report.activeGame.processName ?? "game"}`,
      label: report.activeGame.displayName ?? report.activeGame.processName ?? "Jogo ativo",
      detail: report.activeGame.windowTitle ?? report.activeGame.message,
      source: "active",
      confidence: report.activeGame.confidence === "high" ? "high" : "medium",
      pid: report.activeGame.pid,
      executable: report.activeGame.executablePath,
      profileId: report.activeGame.matchedProfile?.id,
      engineHint: engineHintFromText(
        `${report.activeGame.processName ?? ""} ${report.activeGame.executablePath ?? ""}`,
      ),
    });
  }

  for (const process of report.detectedGames) {
    targets.push(gameTargetFromProcess(process));
  }

  for (const profile of report.gameProfiles) {
    targets.push(gameTargetFromProfile(profile));
  }

  targets.push({
    id: "preset-fate-trigger-ue5",
    label: "Fate Trigger",
    detail: "Prioridade NEXT: Fate Trigger via Steam em Unreal Engine 5.",
    source: "preset",
    confidence: "high",
    executable: "FateTrigger-Win64-Shipping.exe",
    engineHint: "Unreal Engine 5",
  });

  return dedupeGameTargets(targets).sort((a, b) => gameTargetRank(a) - gameTargetRank(b));
}

function gameTargetFromProcess(process: GamerProcess): OptimizeAllGameTarget {
  return {
    id: `process-${process.pid}`,
    label: process.displayName,
    detail: `${process.memoryMb} MB em uso${process.executablePath ? ` - ${process.executablePath}` : ""}`,
    source: "detected",
    confidence: "high",
    pid: process.pid,
    executable: process.executablePath,
    engineHint: engineHintFromText(`${process.name} ${process.executablePath ?? ""}`),
  };
}

function gameTargetFromProfile(profile: GamerGameProfile): OptimizeAllGameTarget {
  return {
    id: `profile-${profile.id}`,
    label: profile.gameName,
    detail: profile.executable,
    source: "profile",
    confidence: "high",
    executable: profile.executable,
    profileId: profile.id,
    engineHint: engineHintFromText(`${profile.gameName} ${profile.executable}`),
  };
}

function dedupeGameTargets(targets: OptimizeAllGameTarget[]) {
  const seen = new Set<string>();
  const result: OptimizeAllGameTarget[] = [];

  for (const target of targets) {
    const key = normalizeGameKey(`${target.label} ${target.executable ?? ""}`);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(target);
  }

  return result;
}

function gameTargetRank(target: OptimizeAllGameTarget) {
  const text = normalizeGameKey(
    `${target.label} ${target.detail ?? ""} ${target.executable ?? ""}`,
  );
  if (
    text.includes("fatetrigger") ||
    text.includes("fatetriggerwin64shipping") ||
    (text.includes("fate") && text.includes("trigger"))
  ) {
    return 0;
  }
  if (target.source === "active") return 1;
  if (target.source === "detected") return 2;
  if (target.source === "profile") return 3;
  return 4;
}

function engineHintFromText(value: string) {
  const normalized = value.toLowerCase();
  if (
    normalized.includes("ue5") ||
    normalized.includes("unreal") ||
    normalized.includes("win64-shipping")
  ) {
    return "Unreal Engine 5";
  }
  return undefined;
}

function shouldApplyFateGraphicsPreference(target?: OptimizeAllGameTarget) {
  return Boolean(
    target &&
    isFateTriggerTarget(target) &&
    target.executable &&
    isWindowsExecutablePath(target.executable),
  );
}

function isFateTriggerTarget(target: OptimizeAllGameTarget) {
  const text = normalizeGameKey(`${target.label} ${target.detail} ${target.executable ?? ""}`);
  return (
    text.includes("fatetrigger") ||
    text.includes("fatetriggerwin64shipping") ||
    (text.includes("fate") && text.includes("trigger"))
  );
}

function isWindowsExecutablePath(value: string) {
  return /^[a-z]:\\/i.test(value) && value.toLowerCase().endsWith(".exe");
}

function normalizeGameKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function tryRun<T>(task: () => Promise<T | null>): Promise<{ value?: T; message?: string }> {
  try {
    const value = await task();
    return value ? { value } : {};
  } catch (error) {
    if (!HERMES_SAFE_TEST_MODE) {
      throw error;
    }
    return { message: errorMessage(error) };
  }
}

function formatGb(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function formatBootAge(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;
  if (hours <= 0) return `${remainingMinutes} min`;
  return `${hours}h ${remainingMinutes}min`;
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
