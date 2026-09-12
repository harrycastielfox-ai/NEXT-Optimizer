import type { ExecutionReportAction, ExecutionReportRisk } from "@/lib/execution-report";
import { isGamerDependencyInstallerAction } from "@/lib/gamer-dependencies";
import type { OptimizeAllPhaseId } from "@/lib/optimize-all";

type AuditMethod = "analysis" | "engine" | "registry" | "cmd" | "powershell" | "profile";

type AuditSeed = {
  slug: string;
  title: string;
  technicalName: string;
  commandPreview: string;
  method: AuditMethod;
  risk: ExecutionReportRisk;
  implemented: boolean;
  weight?: number;
};

type AuditPhaseDefinition = {
  phaseId: OptimizeAllPhaseId;
  phaseTitle: string;
  phaseDetail: string;
  actions: AuditSeed[];
};

export type OptimizeAuditAction = AuditSeed & {
  id: string;
  phaseId: OptimizeAllPhaseId;
  phaseTitle: string;
  phaseDetail: string;
};

export const OPTIMIZE_AUDIT_PHASES: AuditPhaseDefinition[] = [
  auditPhase("plan", "Plano inteligente", "Orquestrador + NEXT Insight", [
    a(
      "diagnostic-health-score",
      "Ler saúde geral",
      "diagnostic.healthScore",
      "diagnostic_engine_read_cached",
      "analysis",
      "info",
      true,
    ),
    a(
      "diagnostic-cpu",
      "Ler CPU",
      "diagnostic.cpu",
      "diagnostic_engine_read_cached.cpu",
      "analysis",
      "info",
      true,
    ),
    a(
      "diagnostic-memory",
      "Ler memoria RAM",
      "diagnostic.memory",
      "diagnostic_engine_read_cached.memory",
      "analysis",
      "info",
      true,
    ),
    a(
      "diagnostic-disk",
      "Ler disco principal",
      "diagnostic.disk",
      "diagnostic_engine_read_cached.disk",
      "analysis",
      "info",
      true,
    ),
    a(
      "diagnostic-gpu",
      "Ler GPU",
      "diagnostic.gpu",
      "diagnostic_engine_read_cached.gpu",
      "analysis",
      "info",
      true,
    ),
    a(
      "advisor-recommendations",
      "Gerar recomendações",
      "advisor.recommendations",
      "advisor_ai_engine_analyze",
      "analysis",
      "info",
      true,
    ),
    a(
      "optimizer-stages",
      "Montar etapas locais",
      "optimizer.stages",
      "optimize_now_plan",
      "analysis",
      "info",
      true,
    ),
    a(
      "profile-score",
      "Pontuar perfil recomendado",
      "profile.score",
      "loadProfilesCatalog + pickProfile",
      "analysis",
      "info",
      true,
    ),
    a(
      "risk-baseline",
      "Classificar risco inicial",
      "risk.baseline",
      "NEXT local policy",
      "analysis",
      "info",
      true,
    ),
    a(
      "restart-policy",
      "Avaliar reinício necessário",
      "restart.policy",
      "system_boot_context_read",
      "analysis",
      "info",
      true,
    ),
    a(
      "admin-context",
      "Verificar administrador",
      "system.adminContext",
      "system_security_context_read",
      "analysis",
      "info",
      true,
    ),
    a(
      "safe-mode-policy",
      "Validar modo teste/real",
      "safeMode.policy",
      "HERMES_SAFE_TEST_MODE",
      "analysis",
      "info",
      true,
    ),
    a(
      "target-game-priority",
      "Priorizar Fate Trigger",
      "gamer.targetPriority",
      "Fate Trigger preset",
      "analysis",
      "info",
      true,
    ),
    a(
      "execution-report",
      "Preparar relatório",
      "execution.report",
      "buildExecutionReport",
      "analysis",
      "info",
      true,
    ),
  ]),
  auditPhase("safety", "Permissões e confirmação", "Modo teste, logs e controle", [
    a(
      "safe-test-lock",
      "Bloqueio de modo teste",
      "safeMode.forceDryRun",
      "safe_mode::force_dry_run",
      "analysis",
      "info",
      true,
    ),
    a(
      "admin-required-detection",
      "Detectar exigencia de admin",
      "system.isElevated",
      "WindowsPrincipal.IsInRole",
      "analysis",
      "info",
      true,
    ),
    a(
      "tauri-command-allowlist",
      "Conferir allowlist Tauri",
      "tauri.invoke.allowlist",
      "tauri::generate_handler",
      "analysis",
      "low",
      true,
    ),
    a(
      "cmd-command-allowlist",
      "Conferir allowlist CMD",
      "advanced.nativeCommandAllowlist",
      "is_allowed_native_command",
      "analysis",
      "medium",
      true,
    ),
    a(
      "restart-dry-run",
      "Validar reinício seguro",
      "system.restart.dryRun",
      "shutdown /r /t 60",
      "cmd",
      "medium",
      true,
    ),
    a(
      "restart-cancel",
      "Validar cancelamento de reinício",
      "system.restart.cancel",
      "shutdown /a",
      "cmd",
      "medium",
      true,
    ),
    a(
      "execution-log",
      "Registrar log da execução",
      "execution.log",
      "localStorage hermes.execution.report.v1",
      "engine",
      "info",
      true,
    ),
    a(
      "phase-gate",
      "Exigir Fase 1 antes da Fase 2",
      "quickPrepare.gate",
      "hermes.quickPrepare.completed.v1",
      "engine",
      "low",
      true,
    ),
    a(
      "boot-verification",
      "Detectar boot após Fase 1",
      "system.boot.currentBootId",
      "Win32_OperatingSystem.LastBootUpTime",
      "powershell",
      "info",
      true,
    ),
    a(
      "unavailable-labeling",
      "Rotular indisponíveis",
      "execution.unavailable",
      "ExecutionReportStatus.unavailable",
      "engine",
      "info",
      true,
    ),
  ]),
  auditPhase("components", "Componentes essenciais", "VC++, DirectX e dependências", [
    a(
      "dism-analyze-component-store",
      "Analisar Component Store",
      "DISM.AnalyzeComponentStore",
      "DISM /Online /Cleanup-Image /AnalyzeComponentStore",
      "cmd",
      "medium",
      true,
    ),
    a(
      "dism-start-component-cleanup",
      "Limpar Component Store",
      "DISM.StartComponentCleanup",
      "DISM /Online /Cleanup-Image /StartComponentCleanup",
      "cmd",
      "medium",
      true,
    ),
    a(
      "dism-check-netfx3",
      "Verificar .NET Framework 3.5",
      "DISM.NetFx3.Check",
      "DISM /Online /Get-FeatureInfo /FeatureName:NetFx3",
      "cmd",
      "low",
      true,
    ),
    a(
      "dism-check-directplay",
      "Verificar DirectPlay",
      "DISM.DirectPlay.Check",
      "DISM /Online /Get-FeatureInfo /FeatureName:DirectPlay",
      "cmd",
      "low",
      true,
    ),
    a(
      "dism-enable-directplay",
      "Habilitar DirectPlay quando necessário",
      "DISM.DirectPlay.Enable",
      "DISM /Online /Enable-Feature /FeatureName:DirectPlay",
      "cmd",
      "medium",
      true,
    ),
    a(
      "vc-redist-2005-x86",
      "Validar VC++ 2005 x86",
      "VC.Redist.2005.x86",
      "instalador oficial Microsoft com SHA256 aprovado e assinatura obrigatoria antes de executar vcredist 2005 x86",
      "cmd",
      "medium",
      true,
    ),
    a(
      "vc-redist-2005-x64",
      "Validar VC++ 2005 x64",
      "VC.Redist.2005.x64",
      "instalador oficial Microsoft com SHA256 aprovado e assinatura obrigatoria antes de executar vcredist 2005 x64",
      "cmd",
      "medium",
      true,
    ),
    a(
      "vc-redist-2008-x86",
      "Validar VC++ 2008 x86",
      "VC.Redist.2008.x86",
      "instalador oficial Microsoft com SHA256 aprovado e assinatura obrigatoria antes de executar vcredist 2008 x86",
      "cmd",
      "medium",
      true,
    ),
    a(
      "vc-redist-2008-x64",
      "Validar VC++ 2008 x64",
      "VC.Redist.2008.x64",
      "instalador oficial Microsoft com SHA256 aprovado e assinatura obrigatoria antes de executar vcredist 2008 x64",
      "cmd",
      "medium",
      true,
    ),
    a(
      "vc-redist-2010-x86",
      "Validar VC++ 2010 x86",
      "VC.Redist.2010.x86",
      "instalador oficial Microsoft com SHA256 aprovado e assinatura obrigatoria antes de executar vcredist 2010 x86",
      "cmd",
      "medium",
      true,
    ),
    a(
      "vc-redist-2010-x64",
      "Validar VC++ 2010 x64",
      "VC.Redist.2010.x64",
      "instalador oficial Microsoft com SHA256 aprovado e assinatura obrigatoria antes de executar vcredist 2010 x64",
      "cmd",
      "medium",
      true,
    ),
    a(
      "vc-redist-2012-x86",
      "Validar VC++ 2012 x86",
      "VC.Redist.2012.x86",
      "instalador oficial Microsoft com SHA256 aprovado e assinatura obrigatoria antes de executar vcredist 2012 x86",
      "cmd",
      "medium",
      true,
    ),
    a(
      "vc-redist-2012-x64",
      "Validar VC++ 2012 x64",
      "VC.Redist.2012.x64",
      "instalador oficial Microsoft com SHA256 aprovado e assinatura obrigatoria antes de executar vcredist 2012 x64",
      "cmd",
      "medium",
      true,
    ),
    a(
      "vc-redist-2013-x86",
      "Validar VC++ 2013 x86",
      "VC.Redist.2013.x86",
      "instalador oficial Microsoft com SHA256 aprovado e assinatura obrigatoria antes de executar vcredist 2013 x86",
      "cmd",
      "medium",
      true,
    ),
    a(
      "vc-redist-2013-x64",
      "Validar VC++ 2013 x64",
      "VC.Redist.2013.x64",
      "instalador oficial Microsoft com SHA256 aprovado e assinatura obrigatoria antes de executar vcredist 2013 x64",
      "cmd",
      "medium",
      true,
    ),
    a(
      "vc-redist-2015-2022-x86",
      "Validar VC++ 2015-2022 x86",
      "VC.Redist.2015_2022.x86",
      "instalador oficial Microsoft/aka.ms com SHA256 aprovado e assinatura obrigatoria antes de executar",
      "cmd",
      "medium",
      true,
    ),
    a(
      "vc-redist-2015-2022-x64",
      "Validar VC++ 2015-2022 x64",
      "VC.Redist.2015_2022.x64",
      "instalador oficial Microsoft/aka.ms com SHA256 aprovado e assinatura obrigatoria antes de executar",
      "cmd",
      "medium",
      true,
    ),
    a(
      "directx-runtime",
      "Validar DirectX Runtime",
      "DirectX.Runtime.Legacy",
      "instalador oficial Microsoft com SHA256 aprovado e assinatura obrigatoria antes de executar DirectX End-User Runtime",
      "cmd",
      "medium",
      true,
    ),
  ]),
  auditPhase("cleanup", "Limpeza segura", "Temporários, cache e logs", [...cleanupSeeds()]),
  auditPhase("startup", "Inicialização", "Apps de alto impacto", [...startupSeeds()]),
  auditPhase("performance", "Performance", "Energia, Game Mode e rede", [...performanceSeeds()]),
  auditPhase("gamer", "Sessão Gamer", "Jogo alvo, Discord e overlays", [...gamerSeeds()]),
  auditPhase("profile", "Consolidação global", "Ajustes internos sem escolha manual", [
    ...profileSeeds(),
  ]),
  auditPhase("manual", "Avançado guiado", "Comandos allowlistados e ajustes finos", [
    a(
      "winsock-reset",
      "Resetar Winsock",
      "Netsh.Winsock.Reset",
      "netsh winsock reset",
      "cmd",
      "medium",
      true,
    ),
    a(
      "reset-ip-stack",
      "Resetar pilha IP",
      "Netsh.IntIp.Reset",
      "netsh int ip reset",
      "cmd",
      "medium",
      true,
    ),
    a(
      "flush-dns-cache",
      "Limpar cache DNS",
      "Ipconfig.FlushDns",
      "ipconfig /flushdns",
      "cmd",
      "low",
      true,
    ),
    a(
      "diagtrack-manual",
      "Telemetria sob demanda",
      "Service.DiagTrack.Start",
      "sc.exe config DiagTrack start= demand",
      "cmd",
      "medium",
      true,
    ),
    a(
      "mapsbroker-manual",
      "Mapas sob demanda",
      "Service.MapsBroker.Start",
      "sc.exe config MapsBroker start= demand",
      "cmd",
      "medium",
      true,
    ),
    a(
      "defender-exclusion-hermes",
      "Permissao Defender do NEXT",
      "Defender.Exclusion.NEX",
      "allow-hermes-defender-exclusion",
      "engine",
      "medium",
      true,
    ),
    a(
      "steam-game-priority",
      "Prioridade Steam/Fate Trigger",
      "Steam.GamePriority.FateTrigger",
      "set-fate-trigger-cpu-priority-high + set-fate-trigger-graphics-high-performance",
      "engine",
      "medium",
      true,
    ),
    a(
      "rollback-manifest-check",
      "Validar manifesto de reversão",
      "Restore.Manifest.Validate",
      "restore_validate_snapshot",
      "engine",
      "info",
      true,
    ),
  ]),
];

export const OPTIMIZE_AUDIT_ACTIONS: OptimizeAuditAction[] = OPTIMIZE_AUDIT_PHASES.flatMap(
  (phase) =>
    phase.actions.map((action) => ({
      ...action,
      id: `${phase.phaseId}.${action.slug}`,
      phaseId: phase.phaseId,
      phaseTitle: phase.phaseTitle,
      phaseDetail: phase.phaseDetail,
    })),
);

export const OPTIMIZE_AUDIT_ACTION_TARGET = OPTIMIZE_AUDIT_ACTIONS.length;

export function buildOptimizeAuditReportActions({
  phaseId,
  phaseStatus,
  safeMode,
  outputs,
}: {
  phaseId: OptimizeAllPhaseId;
  phaseStatus: "completed" | "unavailable";
  safeMode: boolean;
  outputs: string[];
}): ExecutionReportAction[] {
  return OPTIMIZE_AUDIT_ACTIONS.filter((action) => action.phaseId === phaseId).map((action) => ({
    id: action.id,
    title: action.title,
    detail: action.phaseDetail,
    phase: action.phaseTitle,
    status: auditStatus(action, phaseStatus, safeMode),
    outputs,
    plannedCount: auditActionWeight(action),
    technicalName: action.technicalName,
    commandPreview: action.commandPreview,
    method: action.method,
    risk: action.risk,
    implemented: action.implemented,
  }));
}

function auditStatus(
  action: OptimizeAuditAction,
  phaseStatus: "completed" | "unavailable",
  safeMode: boolean,
): ExecutionReportAction["status"] {
  if (phaseStatus === "unavailable") {
    return "unavailable";
  }
  if (action.method === "analysis") {
    return "scanned";
  }
  if (!action.implemented && isGamerDependencyInstallerAction(action.slug)) {
    return "unavailable";
  }
  if (!action.implemented) {
    return "planned";
  }
  return safeMode ? "simulated" : "applied";
}

function auditPhase(
  phaseId: OptimizeAllPhaseId,
  phaseTitle: string,
  phaseDetail: string,
  actions: AuditSeed[],
): AuditPhaseDefinition {
  return { phaseId, phaseTitle, phaseDetail, actions };
}

function a(
  slug: string,
  title: string,
  technicalName: string,
  commandPreview: string,
  method: AuditMethod,
  risk: ExecutionReportRisk,
  implemented: boolean,
  weight?: number,
): AuditSeed {
  return { slug, title, technicalName, commandPreview, method, risk, implemented, weight };
}

function auditActionWeight(action: OptimizeAuditAction) {
  if (action.weight) {
    return action.weight;
  }

  if (action.phaseId === "plan") return 1;
  if (action.phaseId === "safety") return action.method === "cmd" ? 2 : 1;
  if (action.phaseId === "cleanup") return action.implemented ? 2 : 1;
  if (action.phaseId === "startup") return action.implemented ? 2 : 1;
  if (action.phaseId === "profile") return action.implemented ? 2 : 1;

  const weights: Record<string, number> = {
    "components.dism-analyze-component-store": 2,
    "components.dism-start-component-cleanup": 3,
    "components.dism-check-netfx3": 2,
    "components.dism-check-directplay": 2,
    "components.dism-enable-directplay": 2,
    "components.directx-runtime": 3,
    "performance.high-performance-plan": 2,
    "performance.disable-transparency": 1,
    "performance.disable-animations": 4,
    "performance.disable-shadows": 2,
    "performance.game-mode-on": 2,
    "performance.game-dvr-off": 3,
    "performance.visual-gamer-minimal": 18,
    "performance.disable-hibernation": 1,
    "performance.disable-startup-delay": 1,
    "performance.boot-timeout-fast": 1,
    "performance.wersvc-manual": 1,
    "performance.wmpnetworksvc-manual": 1,
    "performance.fax-manual": 1,
    "performance.retaildemo-manual": 1,
    "performance.phonesvc-manual": 1,
    "performance.walletservice-manual": 1,
    "performance.xbl-auth-manager-manual": 1,
    "performance.xbl-game-save-manual": 1,
    "performance.xbox-net-api-svc-manual": 1,
    "performance.network-autotuning": 2,
    "performance.network-ecn": 1,
    "performance.network-rss": 1,
    "performance.multimedia-system-profile": 3,
    "performance.gpu-priority": 2,
    "performance.cpu-priority": 2,
    "performance.background-apps": 3,
    "performance.notifications-off": 2,
    "performance.focus-assist": 2,
    "gamer.gamer-1": 2,
    "gamer.gamer-2": 4,
    "gamer.gamer-3": 2,
    "gamer.gamer-4": 2,
    "gamer.gamer-5": 6,
    "gamer.gamer-6": 3,
    "gamer.gamer-7": 2,
    "gamer.gamer-8": 2,
    "gamer.gamer-9": 2,
    "gamer.gamer-10": 2,
    "gamer.gamer-11": 2,
    "gamer.gamer-12": 2,
    "gamer.gamer-13": 2,
    "gamer.gamer-14": 2,
    "gamer.gamer-15": 2,
    "gamer.gamer-16": 2,
    "gamer.gamer-17": 3,
    "gamer.gamer-18": 1,
    "manual.winsock-reset": 2,
    "manual.reset-ip-stack": 2,
    "manual.flush-dns-cache": 1,
    "manual.diagtrack-manual": 1,
    "manual.mapsbroker-manual": 1,
    "manual.steam-game-priority": 3,
    "manual.rollback-manifest-check": 1,
  };

  if (action.slug.startsWith("vc-redist-")) return 2;

  return weights[action.id] ?? 1;
}

function cleanupSeeds(): AuditSeed[] {
  const implementedCleanupTitles = new Set([
    "Store cache",
    "NVIDIA shader cache",
    "AMD shader cache",
    "Steam download cache",
    "Epic launcher cache",
    "Battle.net cache",
    "Discord cache",
    "OBS cache",
    "Log rotation",
    "Storage summary",
  ]);

  return [
    "Windows Temp",
    "User Temp",
    "Prefetch seguro",
    "Logs do Windows",
    "Cache de miniaturas",
    "Recycle Bin",
    "Windows Update cache",
    "Delivery Optimization cache",
    "DirectX Shader Cache",
    "Browser cache detectado",
    "Crash dumps",
    "WER reports",
    "Installer leftovers",
    "Old update residues",
    "NEXT quarantine purge",
    "DNS resolver cache",
    "Store cache",
    "NVIDIA shader cache",
    "AMD shader cache",
    "Steam download cache",
    "Epic launcher cache",
    "Battle.net cache",
    "Discord cache",
    "OBS cache",
    "Log rotation",
    "Storage summary",
  ].map((title, index) =>
    a(
      `cleanup-${index + 1}`,
      title,
      `Clean.${slugify(title)}`,
      index < 16 || implementedCleanupTitles.has(title)
        ? "clean_engine_apply"
        : `planejado: limpar ${title}`,
      index < 16 || implementedCleanupTitles.has(title) ? "engine" : "powershell",
      index < 16 || implementedCleanupTitles.has(title) ? "low" : "medium",
      index < 16 || implementedCleanupTitles.has(title),
    ),
  );
}

function startupSeeds(): AuditSeed[] {
  const implementedStartupTitles = new Set([
    "Startup folder review",
    "Scheduled startup tasks",
    "OneDrive policy review",
    "Teams auto-start review",
    "Launcher auto-start review",
    "Updater auto-start review",
    "Background app impact",
    "Boot time baseline",
    "Rollback startup manifest",
    "Post-reboot validation",
  ]);

  return [
    "Mapear apps ativos",
    "Desativar alto impacto controlável",
    "Preservar antivirus",
    "Preservar drivers de GPU",
    "Preservar audio essencial",
    "Preservar Discord se Gamer",
    "Atraso de inicialização OFF",
    "Startup Run key review",
    "Startup folder review",
    "Scheduled startup tasks",
    "OneDrive policy review",
    "Teams auto-start review",
    "Launcher auto-start review",
    "Updater auto-start review",
    "Background app impact",
    "Boot time baseline",
    "Rollback startup manifest",
    "Post-reboot validation",
  ].map((title, index) =>
    a(
      `startup-${index + 1}`,
      title,
      `Startup.${slugify(title)}`,
      index < 8 || implementedStartupTitles.has(title)
        ? "startup_engine_apply"
        : `planejado: ${title}`,
      index < 8 || implementedStartupTitles.has(title) ? "engine" : "registry",
      index < 6 ? "low" : "medium",
      index < 8 || implementedStartupTitles.has(title),
    ),
  );
}

function performanceSeeds(): AuditSeed[] {
  return [
    [
      "high-performance-plan",
      "Plano Alto Desempenho",
      "PowerPlan.HighPerformance",
      "powercfg /setactive SCHEME_MIN",
      true,
    ],
    [
      "disable-transparency",
      "Transparencia OFF",
      "Visual.Transparency",
      "HKCU Personalize EnableTransparency=0",
      true,
    ],
    ["disable-animations", "Animações OFF", "Visual.Animations", "HKCU VisualEffects", true],
    ["disable-shadows", "Sombras visuais OFF", "Visual.Shadows", "HKCU VisualEffects", true],
    [
      "game-mode-on",
      "Game Mode ON",
      "GameBar.AllowAutoGameMode",
      "HKCU GameBar AutoGameModeEnabled=1",
      true,
    ],
    ["game-dvr-off", "GameDVR OFF", "GameDVR.AppCapture", "HKCU GameDVR AppCaptureEnabled=0", true],
    [
      "visual-gamer-minimal",
      "Visual gamer mínimo",
      "Visual.PerformancePreset",
      "SystemPropertiesPerformance.exe preset",
      true,
    ],
    ["disable-hibernation", "Hibernação OFF", "Power.Hibernate", "powercfg /hibernate off", true],
    [
      "disable-startup-delay",
      "Startup delay OFF",
      "Explorer.StartupDelay",
      "HKCU Serialize StartupDelayInMSec=0",
      true,
    ],
    ["boot-timeout-fast", "Boot menu 5s", "Boot.Timeout", "advanced.set-boot-timeout-fast", true],
    [
      "wersvc-manual",
      "Windows Error Reporting sob demanda",
      "Service.WerSvc.Start",
      "advanced.set-wersvc-service-manual",
      true,
    ],
    [
      "wmpnetworksvc-manual",
      "Compartilhamento de midia sob demanda",
      "Service.WMPNetworkSvc.Start",
      "advanced.set-wmpnetworksvc-service-manual",
      true,
    ],
    ["fax-manual", "Fax sob demanda", "Service.Fax.Start", "advanced.set-fax-service-manual", true],
    [
      "retaildemo-manual",
      "Retail Demo sob demanda",
      "Service.RetailDemo.Start",
      "advanced.set-retaildemo-service-manual",
      true,
    ],
    [
      "phonesvc-manual",
      "Phone Service sob demanda",
      "Service.PhoneSvc.Start",
      "advanced.set-phonesvc-service-manual",
      true,
    ],
    [
      "walletservice-manual",
      "Wallet Service sob demanda",
      "Service.WalletService.Start",
      "advanced.set-walletservice-manual",
      true,
    ],
    [
      "xbl-auth-manager-manual",
      "Xbox Live Auth sob demanda",
      "Service.XblAuthManager.Start",
      "advanced.set-xbl-auth-manager-manual",
      true,
    ],
    [
      "xbl-game-save-manual",
      "Xbox Game Save sob demanda",
      "Service.XblGameSave.Start",
      "advanced.set-xbl-game-save-manual",
      true,
    ],
    [
      "xbox-net-api-svc-manual",
      "Xbox Networking sob demanda",
      "Service.XboxNetApiSvc.Start",
      "advanced.set-xbox-net-api-svc-manual",
      true,
    ],
    [
      "network-autotuning",
      "Auto tuning de rede",
      "NetTCP.AutoTuning",
      "netsh int tcp set global autotuninglevel=normal",
      true,
    ],
    [
      "network-ecn",
      "ECN seguro",
      "NetTCP.ECN",
      "netsh int tcp set global ecncapability=disabled",
      true,
    ],
    ["network-rss", "RSS de rede", "NetTCP.RSS", "netsh int tcp set global rss=enabled", true],
    [
      "multimedia-system-profile",
      "SystemResponsiveness gamer",
      "MMCSS.SystemResponsiveness",
      "HKLM Multimedia SystemProfile SystemResponsiveness=0",
      true,
    ],
    ["gpu-priority", "GPU Priority", "MMCSS.GpuPriority", "HKLM Games Tasks GPU Priority=8", true],
    ["cpu-priority", "CPU Priority", "MMCSS.Priority", "HKLM Games Tasks Priority=6", true],
    [
      "timer-resolution",
      "Timer resolution policy",
      "Timer.Resolution",
      "advanced.check-timer-resolution-policy",
      true,
    ],
    [
      "ultimate-performance",
      "Ultimate Performance opcional",
      "PowerPlan.Ultimate",
      "powercfg /duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61",
      true,
    ],
    [
      "usb-selective-suspend",
      "USB selective suspend review",
      "Power.UsbSelectiveSuspend",
      "powercfg /SETACVALUEINDEX SCHEME_CURRENT USB selective suspend=0",
      true,
    ],
    [
      "pcie-link-state",
      "PCIe link state review",
      "Power.PcieLinkState",
      "powercfg /SETACVALUEINDEX SCHEME_CURRENT PCIe Link State=0",
      true,
    ],
    [
      "background-apps",
      "Apps em segundo plano",
      "BackgroundApps.Policy",
      "advanced.disable-background-apps",
      true,
    ],
    [
      "notifications-off",
      "Notificações foco gamer",
      "Notifications.Gamer",
      "advanced.disable-notification-toasts",
      true,
    ],
    [
      "focus-assist",
      "Assistente de foco",
      "FocusAssist.Gaming",
      "advanced.set-focus-assist-gamer",
      true,
    ],
  ].map(([slug, title, technical, command, implemented]) =>
    a(
      String(slug),
      String(title),
      String(technical),
      String(command),
      "registry",
      "medium",
      Boolean(implemented),
    ),
  );
}

function gamerSeeds(): AuditSeed[] {
  const implementedGamerTitles = new Set([
    "Game Bar policy",
    "Xbox overlay review",
    "NVIDIA overlay review",
    "AMD overlay review",
    "Steam overlay review",
    "OBS streaming exception",
    "BlueStacks/WSL exception",
    "Network route refresh",
    "Shader cache readiness",
    "Game process priority",
    "Post-game restore point",
  ]);

  return [
    "Detectar Fate Trigger Steam",
    "Priorizar Fate Trigger UE5",
    "Escolher jogo alvo",
    "Preservar Discord",
    "Fechar processos seguros",
    "Preservar anticheat",
    "Preservar overlay escolhido",
    "Game Bar policy",
    "Xbox overlay review",
    "NVIDIA overlay review",
    "AMD overlay review",
    "Steam overlay review",
    "OBS streaming exception",
    "BlueStacks/WSL exception",
    "Network route refresh",
    "Shader cache readiness",
    "Game process priority",
    "Post-game restore point",
  ].map((title, index) =>
    a(
      `gamer-${index + 1}`,
      title,
      `Gamer.${slugify(title)}`,
      index < 7 || implementedGamerTitles.has(title)
        ? "gamer_engine_apply + advanced/clean support"
        : `planejado: ${title}`,
      index < 7 || implementedGamerTitles.has(title) ? "engine" : "powershell",
      index < 7 || implementedGamerTitles.has(title) ? "low" : "medium",
      index < 7 || implementedGamerTitles.has(title),
    ),
  );
}

function profileSeeds(): AuditSeed[] {
  const implementedProfileTitles = new Set([
    "Validar conflito entre perfis",
    "Sugerir perfil por IA local",
    "Persistir perfil recomendado",
    "Relatório do perfil aplicado",
  ]);

  return [
    "Perfil Seguro",
    "Perfil Gamer",
    "Perfil Streamer",
    "Perfil Trabalho",
    "Perfil Economia",
    "Perfil Criação",
    "Perfil Avançado",
    "Perfil Extremo bloqueado",
    "Aplicar energia do perfil",
    "Aplicar startup do perfil",
    "Aplicar performance do perfil",
    "Aplicar advanced do perfil",
    "Validar conflito entre perfis",
    "Sugerir perfil por IA local",
    "Persistir perfil recomendado",
    "Relatório do perfil aplicado",
  ].map((title, index) =>
    a(
      `profile-${index + 1}`,
      title,
      `Profile.${slugify(title)}`,
      index < 12 || implementedProfileTitles.has(title) ? "profiles_apply" : `planejado: ${title}`,
      "profile",
      index === 7 ? "high" : index < 12 ? "medium" : "info",
      index < 12 || implementedProfileTitles.has(title),
    ),
  );
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, ".")
    .replace(/(^\.|\.$)/g, "")
    .toLowerCase();
}
