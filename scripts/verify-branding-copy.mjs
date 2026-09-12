import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

const files = {
  rootRoute: read("src/routes/__root.tsx"),
  errorPage: read("src/lib/error-page.ts"),
  errorReporting: read("src/lib/lovable-error-reporting.ts"),
  dashboardRoute: read("src/routes/index.tsx"),
  otimizarRoute: read("src/routes/otimizar.tsx"),
  quickPrepareModal: read("src/components/optimization/QuickPrepareModal.tsx"),
  smartOptimizeModal: read("src/components/optimization/SmartOptimizeModal.tsx"),
  sidebar: read("src/components/dashboard/Sidebar.tsx"),
  configuracoesRoute: read("src/routes/configuracoes.tsx"),
  manutencaoRoute: read("src/routes/manutencao-programada.tsx"),
};

const forbiddenRootCopy = [
  "@Lovable",
  ".lovable.app",
  "Page not found",
  "This page didn't load",
  "Something went wrong",
  "Try again",
  "Go home",
];

const mojibakePatterns = [
  "\u00c3\u00a1",
  "\u00c3\u00a0",
  "\u00c3\u00a2",
  "\u00c3\u00a3",
  "\u00c3\u00a7",
  "\u00c3\u00a9",
  "\u00c3\u00aa",
  "\u00c3\u00ad",
  "\u00c3\u00b3",
  "\u00c3\u00b4",
  "\u00c3\u00b5",
  "\u00c3\u00ba",
  "\u00c3\u0081",
  "\u00c3\u0089",
  "\u00c3\u0093",
  "\u00c3\u009a",
  "\u00c3\u0087",
  "\u00c2",
  "\ufffd",
];

const coreCopyFiles = Object.entries(files);

function walkSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(fullPath);
    return [fullPath];
  });
}

const allSourceCopyFiles = walkSourceFiles(join(root, "src"))
  .filter((filePath) => [".ts", ".tsx"].includes(extname(filePath)))
  .map((filePath) => [filePath, readFileSync(filePath, "utf8")]);

function hasNoMojibake(content) {
  return mojibakePatterns.every((fragment) => !content.includes(fragment));
}

const checks = [
  {
    name: "Root usa metadata NEXT sem starter remoto",
    ok:
      files.rootRoute.includes('content: "NEXT Optimizer"') &&
      files.rootRoute.includes('content: "/nex-logo.png"') &&
      forbiddenRootCopy.every((fragment) => !files.rootRoute.includes(fragment)),
  },
  {
    name: "Tela 404 e erro root estao em portugues",
    ok:
      files.rootRoute.includes("Página não encontrada") &&
      files.rootRoute.includes("Esta tela não carregou") &&
      files.rootRoute.includes("Voltar ao Dashboard") &&
      files.rootRoute.includes("Tentar novamente"),
  },
  {
    name: "Pagina HTML de erro esta em pt-BR",
    ok:
      files.errorPage.includes('<html lang="pt-BR">') &&
      files.errorPage.includes("Esta tela não carregou") &&
      files.errorPage.includes("Voltar ao Dashboard") &&
      forbiddenRootCopy.every((fragment) => !files.errorPage.includes(fragment)),
  },
  {
    name: "Wrapper de erro usa nome generico NEXT",
    ok:
      files.errorReporting.includes("reportClientError") &&
      !files.errorReporting.includes("reportLovableError") &&
      !files.errorReporting.includes("type Lovable"),
  },
  {
    name: "Arquivos de copy principal nao possuem mojibake",
    ok: coreCopyFiles.every(([, content]) => hasNoMojibake(content)),
  },
  {
    name: "Todo o frontend nao possui mojibake",
    ok: allSourceCopyFiles.every(([, content]) => hasNoMojibake(content)),
  },
  {
    name: "Tela Otimizar mantem copy principal com acentos corretos",
    ok:
      files.otimizarRoute.includes("Preparar e otimizar") &&
      files.otimizarRoute.includes("Iniciar preparação") &&
      files.otimizarRoute.includes("Iniciar otimização") &&
      files.otimizarRoute.includes("Reinício necessário"),
  },
  {
    name: "Modais dos botoes mantem copy principal com acentos corretos",
    ok:
      files.quickPrepareModal.includes("Preparação da Máquina") &&
      files.quickPrepareModal.includes("Reinício recomendado") &&
      files.quickPrepareModal.includes("Dependências gamer") &&
      files.smartOptimizeModal.includes("Permissões e confirmação") &&
      files.smartOptimizeModal.includes("Plano único concluído") &&
      files.smartOptimizeModal.includes("Dependências gamer"),
  },
];

const failed = checks.filter((check) => !check.ok);

for (const check of checks) {
  console.log(`${check.ok ? "OK" : "FAIL"} ${check.name}`);
}

if (failed.length > 0) {
  console.error("");
  console.error(`Branding/copy invalido: ${failed.length} verificacao(oes) falharam.`);
  process.exit(1);
}

console.log("");
console.log("Branding e textos principais validados.");
