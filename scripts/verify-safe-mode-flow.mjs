import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(...parts) {
  return readFileSync(join(root, ...parts), "utf8");
}

const files = {
  safeMode: read("src", "lib", "safe-mode.ts"),
  quickPrepare: read("src", "lib", "quick-prepare.ts"),
  quickPrepareModal: read("src", "components", "optimization", "QuickPrepareModal.tsx"),
  optimizeAll: read("src", "lib", "optimize-all.ts"),
  smartModal: read("src", "components", "optimization", "SmartOptimizeModal.tsx"),
  globalAnalysis: read("src", "components", "analysis", "GlobalAnalysisModal.tsx"),
  diagnostic: read("src", "lib", "diagnostic.ts"),
  verification: read("src", "lib", "execution-verification.ts"),
  advanced: read("src", "lib", "advanced.ts"),
  clean: read("src", "lib", "clean.ts"),
  executionOutcome: read("src", "lib", "execution-outcome.ts"),
};

const checks = [
  {
    name: "Simulacao bem sucedida dispensa reinicio sem liberar execucao real ou incompleta",
    ok:
      files.executionOutcome.includes('if (safeMode) return "confirmed"') &&
      files.executionOutcome.includes("gate.hasIssues !== false || gate.safeMode !== safeMode") &&
      files.executionOutcome.indexOf("gate.hasIssues !== false") <
        files.executionOutcome.indexOf('if (safeMode) return "confirmed"') &&
      files.quickPrepareModal.includes(
        'runStatus === "completed" && !hasIssues && !HERMES_SAFE_TEST_MODE',
      ),
  },
  {
    name: "Modo seguro do frontend continua ligado por padrao",
    ok:
      files.safeMode.includes("VITE_HERMES_SAFE_TEST_MODE") &&
      files.safeMode.includes("parseSafeModeFlag(SAFE_TEST_MODE_ENV) ?? true"),
  },
  {
    name: "Modo seguro ainda forca dry-run e remove confirmacao real",
    ok:
      files.safeMode.includes("forceSafeDryRun") &&
      files.safeMode.includes("confirmed: false") &&
      files.safeMode.includes("dryRun: true"),
  },
  {
    name: "Botao 1 escolhe dry-run quando o modo seguro esta ativo",
    ok:
      files.quickPrepareModal.includes(
        'const executionMode = HERMES_SAFE_TEST_MODE ? "dryRun" : "real"',
      ) &&
      files.quickPrepareModal.includes(
        "buildQuickPrepareTaskPlan({ dnsProviderId, executionMode })",
      ) &&
      files.quickPrepareModal.includes("{ dnsProviderId, executionMode }"),
  },
  {
    name: "Botao 1 verifica acoes sem exigir confirmacao real em modo seguro",
    ok:
      files.quickPrepareModal.includes("verifyExecutionActions(") &&
      files.quickPrepareModal.includes("HERMES_SAFE_TEST_MODE") &&
      files.quickPrepareModal.includes("safeMode: HERMES_SAFE_TEST_MODE") &&
      files.quickPrepareModal.includes("Modo teste:") &&
      files.quickPrepareModal.includes("nenhuma"),
  },
  {
    name: "Executor do Botao 1 mantem tarefas reais em dry-run ate build real",
    ok:
      files.quickPrepare.includes('context.executionMode !== "real"') &&
      files.quickPrepare.includes("if (HERMES_SAFE_TEST_MODE)") &&
      files.quickPrepare.includes('step.realPolicy === "scanOnly"') &&
      files.quickPrepare.includes('step.realPolicy === "adminOnly"') &&
      files.quickPrepare.includes(
        'return context.executionMode !== "real" || HERMES_SAFE_TEST_MODE',
      ),
  },
  {
    name: "Botao 2 usa HERMES_SAFE_TEST_MODE para dry-run e confirmacao real",
    ok:
      files.optimizeAll.includes("function shouldDryRun()") &&
      files.optimizeAll.includes("return HERMES_SAFE_TEST_MODE;") &&
      files.optimizeAll.includes("function shouldConfirmReal()") &&
      files.optimizeAll.includes("return !HERMES_SAFE_TEST_MODE;") &&
      files.smartModal.includes('value={HERMES_SAFE_TEST_MODE ? "Teste" : "Real"}') &&
      files.smartModal.includes("safeMode: HERMES_SAFE_TEST_MODE"),
  },
  {
    name: "Wrappers Optimize Now ainda respeitam modo seguro no frontend",
    ok:
      files.advanced.includes('"advanced_engine_apply_optimize_now"') &&
      files.advanced.includes("request: forceSafeDryRun(request)") &&
      files.clean.includes('"clean_engine_apply_optimize_now"') &&
      files.clean.includes("request: forceSafeDryRun(request)"),
  },
  {
    name: "Relatorio pos-execucao nao tenta confirmar mudanca real em modo seguro",
    ok:
      files.verification.includes("if (safeMode)") &&
      files.verification.includes("notRequiredVerification") &&
      files.verification.includes("Modo teste:") &&
      files.verification.includes("nenhuma"),
  },
  {
    name: "Dashboard e Analise Agora continuam somente leitura",
    ok:
      files.globalAnalysis.includes("assertReadOnly") &&
      files.globalAnalysis.includes('executeStage(runId, "diagnostic"') &&
      files.globalAnalysis.includes("refreshDiagnosticReport()") &&
      files.globalAnalysis.includes("performance.readOnly && !performance.willModifySystem") &&
      files.globalAnalysis.includes("gamer.readOnly && !gamer.willModifySystem") &&
      files.globalAnalysis.includes("advisor.readOnly && !advisor.willModifySystem") &&
      files.diagnostic.includes("readOnly: true"),
  },
];

const failed = checks.filter((check) => !check.ok);

for (const check of checks) {
  console.log(`${check.ok ? "OK" : "FAIL"} ${check.name}`);
}

if (failed.length > 0) {
  console.error("");
  console.error(`Fluxo seguro invalido: ${failed.length} verificacao(oes) falharam.`);
  process.exit(1);
}

console.log("");
console.log(
  "Fluxo seguro validado: Dashboard somente leitura, Botao 1/2 em dry-run e verificacao segura.",
);
