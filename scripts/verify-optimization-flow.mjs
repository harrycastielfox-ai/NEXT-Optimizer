import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const files = {
  otimizarRoute: readFileSync(join(root, "src", "routes", "otimizar.tsx"), "utf8"),
  smartModal: readFileSync(
    join(root, "src", "components", "optimization", "SmartOptimizeModal.tsx"),
    "utf8",
  ),
  quickModal: readFileSync(
    join(root, "src", "components", "optimization", "QuickPrepareModal.tsx"),
    "utf8",
  ),
  restartPrompt: readFileSync(
    join(root, "src", "components", "optimization", "RestartPrompt.tsx"),
    "utf8",
  ),
  advancedLib: readFileSync(join(root, "src", "lib", "advanced.ts"), "utf8"),
  optimizeAll: readFileSync(join(root, "src", "lib", "optimize-all.ts"), "utf8"),
  gamerDependencies: readFileSync(join(root, "src", "lib", "gamer-dependencies.ts"), "utf8"),
  quickPrepare: readFileSync(join(root, "src", "lib", "quick-prepare.ts"), "utf8"),
  executionReport: readFileSync(join(root, "src", "lib", "execution-report.ts"), "utf8"),
  executionOutcome: readFileSync(join(root, "src", "lib", "execution-outcome.ts"), "utf8"),
  gamerDependencyEngine: readFileSync(
    join(root, "src-tauri", "src", "gamer_dependencies.rs"),
    "utf8",
  ),
  advancedEngine: readFileSync(join(root, "src-tauri", "src", "advanced.rs"), "utf8"),
  systemBackend: readFileSync(join(root, "src-tauri", "src", "system.rs"), "utf8"),
};

const checks = [
  {
    name: "Botao 1 possui marcador estavel",
    ok:
      files.otimizarRoute.includes('data-testid="hermes-prepare-start"') ||
      files.otimizarRoute.includes('testId="hermes-prepare-start"'),
  },
  {
    name: "Botao 2 possui marcador estavel",
    ok:
      files.otimizarRoute.includes('data-testid="hermes-optimize-start"') ||
      files.otimizarRoute.includes('testId="hermes-optimize-start"'),
  },
  {
    name: "Botao 2 continua bloqueado antes da Fase 1",
    ok:
      files.otimizarRoute.includes("!quickPrepareGate") &&
      files.otimizarRoute.includes('data-testid="hermes-optimize-locked"') &&
      files.otimizarRoute.includes("Conclua a Fase 1 primeiro"),
  },
  {
    name: "Modal do Botao 2 possui marcador de QA",
    ok: files.smartModal.includes('data-testid="hermes-optimize-modal"'),
  },
  {
    name: "Fluxo do Botao 2 nao pausa para selecao de jogo",
    ok:
      !files.smartModal.includes('setRunStatus("awaitingGame")') &&
      !files.smartModal.includes("Escolha o jogo alvo para continuar.") &&
      !files.smartModal.includes('data-testid="hermes-game-target-picker"') &&
      files.smartModal.includes('value="Global"'),
  },
  {
    name: "Fate Trigger segue como prioridade Gamer",
    ok:
      files.optimizeAll.includes('id: "preset-fate-trigger-ue5"') &&
      files.optimizeAll.includes('label: "Fate Trigger"') &&
      files.optimizeAll.includes('executable: "FateTrigger-Win64-Shipping.exe"') &&
      files.optimizeAll.includes("return 0;"),
  },
  {
    name: "Fate Trigger tem prioridade interna no pacote global",
    ok:
      files.optimizeAll.includes("pickGlobalGamerTarget") &&
      files.optimizeAll.includes('target.id === "preset-fate-trigger-ue5"') &&
      files.optimizeAll.includes("Prioridade gamer global"),
  },
  {
    name: "Sucesso do Botao 2 fica visivel sem relatorio tecnico longo",
    ok:
      files.smartModal.includes('data-testid="hermes-optimize-success"') &&
      files.smartModal.includes("Otimiza") &&
      files.smartModal.includes("conclu"),
  },
  {
    name: "Botao 2 comunica plano global e exige reinicio",
    ok:
      files.otimizarRoute.includes("Boot rápido, sistema e plano global") &&
      files.otimizarRoute.includes("Rede, serviços sob demanda, Gamer e Fate Trigger") &&
      files.otimizarRoute.includes('data-testid="hermes-optimize-waiting-restart"') &&
      !files.otimizarRoute.includes("Iniciar mesmo assim"),
  },
  {
    name: "Reinicio real exige clique, confirmacao e permite cancelar a contagem de 60 segundos",
    ok:
      !files.restartPrompt.includes("autoRestartRequested") &&
      !files.restartPrompt.includes("void handleRestart()") &&
      files.restartPrompt.includes("onClick={handleRestart}") &&
      files.restartPrompt.includes("window.confirm(") &&
      files.restartPrompt.indexOf("window.confirm(") <
        files.restartPrompt.indexOf("await requestSystemRestart(") &&
      files.restartPrompt.includes("delaySeconds: 60") &&
      files.restartPrompt.includes("onClick={handleCancelRestart}") &&
      files.restartPrompt.includes("dryRun: HERMES_SAFE_TEST_MODE") &&
      files.systemBackend.includes("clamp(5, 300)"),
  },
  {
    name: "Fase 1 persiste resultado antes de concluir e bloqueia fase real sem boot confirmado",
    ok:
      files.quickModal.includes("await onCompleted?.(nextReports, executionReport)") &&
      files.quickModal.indexOf("await onCompleted?.(nextReports, executionReport)") <
        files.quickModal.indexOf('setRunStatus("completed")') &&
      files.otimizarRoute.includes("hasIssues: hasExecutionIssues(executionReport)") &&
      files.otimizarRoute.includes("getPrepareRebootStatus(") &&
      files.executionOutcome.includes("gate.hasIssues !== false") &&
      files.executionOutcome.includes("gate.safeMode !== safeMode") &&
      files.executionOutcome.includes(
        'if (!bootContext?.available || !bootContext.isWindows) return "pending"',
      ) &&
      files.executionOutcome.includes(
        'bootContext.currentBootId !== gate.bootIdAtCompletion ? "confirmed" : "pending"',
      ),
  },
  {
    name: "Botao 2 usa wrappers Optimize Now para Clean e Advanced",
    ok:
      files.optimizeAll.includes("applyOptimizeNowCleanEngine") &&
      files.optimizeAll.includes("applyOptimizeNowAdvancedActions") &&
      !files.optimizeAll.includes("applyCleanEngine") &&
      !files.optimizeAll.includes("applyAdvancedActions({"),
  },
  {
    name: "Modo teste nao baixa dependencias gamer",
    ok:
      files.gamerDependencies.includes("if (request.dryRun)") &&
      files.gamerDependencies.includes("Modo teste: nenhum download foi iniciado.") &&
      files.gamerDependencies.indexOf("if (request.dryRun)") <
        files.gamerDependencies.indexOf(
          "const downloadResult = await downloadOfficialGamerDependencyInstallers()",
        ),
  },
  {
    name: "Modo real nao conclui com dependencia gamer incompleta",
    ok:
      files.gamerDependencies.includes("gamerDependencyPreparationIssues") &&
      files.quickPrepare.includes("dependencyIssues.length === 0") &&
      files.quickPrepare.includes(
        'result.status === "unavailable" && requiresRealAdmin(context)',
      ) &&
      files.optimizeAll.includes("Dependências gamer incompletas") &&
      files.smartModal.includes("if (!HERMES_SAFE_TEST_MODE)"),
  },
  {
    name: "Dependencia ja instalada nao e baixada novamente",
    ok:
      files.gamerDependencyEngine.includes("dependency_already_installed(package)") &&
      files.gamerDependencyEngine.includes("download dispensado"),
  },
  {
    name: "Catalogo avancado aceita arrays nulos retornados pelo Windows",
    ok: /#\[serde\(default, deserialize_with = "deserialize_nullable_string_vec"\)\]\s+defender_exclusion_paths/.test(
      files.advancedEngine,
    ),
  },
  {
    name: "Meta visual usa alvo central de 160 acoes",
    ok:
      files.executionReport.includes("HERMES_ACTION_TARGET = 160") &&
      files.otimizarRoute.includes("value: `${HERMES_ACTION_TARGET} ações`") &&
      files.smartModal.includes("${OPTIMIZE_AUDIT_ACTION_TARGET} ações auditáveis"),
  },
  {
    name: "Relatorio interno respeita retorno skipped da Advanced Engine",
    ok:
      files.smartModal.includes("mergeAdvancedExecutionDetails") &&
      files.smartModal.includes('if (status === "skipped") return "unavailable"') &&
      files.smartModal.includes("advancedActionIdFromReportAction"),
  },
  {
    name: "Resumo do motor avancado separa aplicado, validado, indisponivel e falha",
    ok:
      files.advancedLib.includes("formatAdvancedActionSummary") &&
      files.advancedLib.includes("summarizeAdvancedActionResults") &&
      files.optimizeAll.includes("formatAdvancedActionSummary") &&
      files.quickPrepare.includes("formatAdvancedActionSummary") &&
      files.smartModal.includes("formatAdvancedActionSummary") &&
      files.advancedLib.includes("summary[action.status] += 1"),
  },
];

const failed = checks.filter((check) => !check.ok);

for (const check of checks) {
  console.log(`${check.ok ? "OK" : "FAIL"} ${check.name}`);
}

if (failed.length > 0) {
  console.error("");
  console.error(`Fluxo Otimizar invalido: ${failed.length} verificacao(oes) falharam.`);
  process.exit(1);
}

console.log("");
console.log("Fluxo Otimizar validado: Botao 1, reinicio obrigatorio, Botao 2 global e sucesso.");
