import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

const requiredRoutes = [
  { label: "Dashboard", route: "/", file: "src/routes/index.tsx" },
  { label: "Otimizar", route: "/otimizar", file: "src/routes/otimizar.tsx" },
  { label: "Anti-Cheat", route: "/anti-cheat", file: "src/routes/anti-cheat.tsx" },
  { label: "Defender", route: "/defender", file: "src/routes/defender.tsx" },
  {
    label: "Manutencao Programada",
    route: "/manutencao-programada",
    file: "src/routes/manutencao-programada.tsx",
  },
  { label: "Configuracoes", route: "/configuracoes", file: "src/routes/configuracoes.tsx" },
];

const files = {
  sidebar: read("src/components/dashboard/Sidebar.tsx"),
  rootRoute: read("src/routes/__root.tsx"),
  routeTree: read("src/routeTree.gen.ts"),
  windowChrome: read("src/components/common/HermesWindowChrome.tsx"),
  styles: read("src/styles.css"),
};

const checks = [
  {
    name: "Sidebar mantem somente a navegacao principal aprovada",
    ok:
      files.sidebar.includes('to: "/"') &&
      files.sidebar.includes('to: "/otimizar"') &&
      files.sidebar.includes('to: "/anti-cheat"') &&
      files.sidebar.includes('to: "/defender"') &&
      files.sidebar.includes('to: "/manutencao-programada"') &&
      files.sidebar.includes('to: "/configuracoes"') &&
      !files.sidebar.includes('to: "/diagnostico"') &&
      !files.sidebar.includes('to: "/central"') &&
      !files.sidebar.includes('to: "/limpeza"') &&
      !files.sidebar.includes('to: "/inicializacao"'),
  },
  {
    name: "Chrome customizado do NEXT e carregado no root",
    ok:
      files.rootRoute.includes("<HermesWindowChrome />") && files.rootRoute.includes("<Outlet />"),
  },
  {
    name: "Janela possui minimizar, maximizar, fechar e arraste",
    ok:
      files.windowChrome.includes('type WindowAction = "minimize" | "maximize" | "close"') &&
      files.windowChrome.includes("startDragging") &&
      files.windowChrome.includes("toggleMaximize") &&
      files.windowChrome.includes('aria-label="Maximizar NEXT"') &&
      files.windowChrome.includes('aria-label="Fechar NEXT"'),
  },
  {
    name: "Janela possui oito alcas de redimensionamento",
    ok:
      (files.windowChrome.match(/direction: "/g) || []).length === 8 &&
      files.windowChrome.includes("startResizeDragging"),
  },
  {
    name: "CSS contem regioes transparentes de resize",
    ok:
      files.styles.includes(".hermes-window-resize") &&
      files.styles.includes("position: fixed") &&
      files.styles.includes("background: transparent") &&
      files.styles.includes(".hermes-window-resize--se") &&
      files.styles.includes(".hermes-window-resize--sw"),
  },
];

for (const { label, route, file } of requiredRoutes) {
  const routePath = join(root, file);
  const routeFile = existsSync(routePath) ? read(file) : "";

  checks.push(
    {
      name: `Arquivo existe para ${label}`,
      ok: existsSync(routePath),
    },
    {
      name: `RouteTree registra ${label}`,
      ok: files.routeTree.includes(`'${route}'`) || files.routeTree.includes(`path: '${route}'`),
    },
    {
      name: `${label} renderiza em area rolavel`,
      ok: /<main\b[^>]*className="[^"]*\boverflow-(?:y-)?auto\b/.test(routeFile),
    },
  );
}

const failed = checks.filter((check) => !check.ok);

for (const check of checks) {
  console.log(`${check.ok ? "OK" : "FAIL"} ${check.name}`);
}

if (failed.length > 0) {
  console.error("");
  console.error(`UI shell invalido: ${failed.length} verificacao(oes) falharam.`);
  process.exit(1);
}

console.log("");
console.log("UI shell validado: sidebar, rotas principais, scroll e janela customizada.");
