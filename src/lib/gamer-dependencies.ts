import type { AdvancedCatalog } from "@/lib/advanced";
import { forceSafeDryRun } from "@/lib/safe-mode";

export type GamerDependencyFamily = "vcredist" | "directx";
export type GamerDependencyArchitecture = "x86" | "x64" | "web";

export type GamerDependencyPackage = {
  id: string;
  title: string;
  family: GamerDependencyFamily;
  version: string;
  architecture: GamerDependencyArchitecture;
  installerFileName: string;
  officialSourcePage: string;
  officialUrl?: string;
  expectedSha256?: string;
  requiredPublisher: "Microsoft Corporation";
  signatureSubject?: string;
  installCommand: string;
  officialSourceStatus: "sourcePageVerified" | "downloadUrlVerified" | "pendingOfficialUrl";
  expectedSha256Status: "requiredBeforeInstall";
  signatureStatus: "requiredBeforeInstall";
};

export type GamerDependencyInstallQueueItem = {
  packageId: string;
  title: string;
  installerFileName: string;
  installCommand: string;
  manifestReady: boolean;
  blocked: boolean;
  blockedReason?: string;
  requiredChecks: string[];
};

export type GamerDependencyInstallPlan = {
  totalPackages: number;
  approvedPackages: number;
  blockedPackages: number;
  canExecute: boolean;
  queue: GamerDependencyInstallQueueItem[];
};

export type GamerDependencyVerificationStatus = "missing" | "blocked" | "verified" | "failed";

export type GamerDependencyVerificationItem = {
  packageId: string;
  title: string;
  installerFileName: string;
  officialSourcePage: string;
  officialUrl?: string;
  cachedPath: string;
  fileExists: boolean;
  installedLocally: boolean;
  status: GamerDependencyVerificationStatus;
  sha256?: string;
  expectedSha256?: string;
  sha256Matches?: boolean;
  signatureStatus?: string;
  signatureSubject?: string;
  publisherMatches?: boolean;
  blockedReasons: string[];
};

export type GamerDependencyVerificationReport = {
  generatedAt: string;
  engineVersion: string;
  cacheDir: string;
  totalPackages: number;
  readyCount: number;
  installedLocallyCount: number;
  blockedCount: number;
  packages: GamerDependencyVerificationItem[];
  warnings: string[];
};

export type GamerDependencyDownloadResult = {
  downloadedCount: number;
  skippedCount: number;
  failedCount: number;
  messages: string[];
  report: GamerDependencyVerificationReport;
};

export type GamerDependencyManifestAuditStatus = "audited" | "cached" | "failed" | "blocked";

export type GamerDependencyManifestAuditItem = {
  packageId: string;
  title: string;
  installerFileName: string;
  officialUrl?: string;
  auditPath: string;
  status: GamerDependencyManifestAuditStatus;
  message: string;
  sha256?: string;
  signatureStatus?: string;
  signatureSubject?: string;
  publisherMatches?: boolean;
  manifestHint?: string;
};

export type GamerDependencyManifestAuditResult = {
  generatedAt: string;
  engineVersion: string;
  auditDir: string;
  totalPackages: number;
  auditedCount: number;
  cachedCount: number;
  failedCount: number;
  blockedCount: number;
  items: GamerDependencyManifestAuditItem[];
  messages: string[];
};

export type GamerDependencyInstallActionStatus =
  | "dryRun"
  | "installed"
  | "skipped"
  | "failed"
  | "blocked";

export type GamerDependencyInstallActionResult = {
  packageId: string;
  title: string;
  installerFileName: string;
  status: GamerDependencyInstallActionStatus;
  message: string;
  commandPreview: string;
};

export type GamerDependencyInstallResult = {
  generatedAt: string;
  engineVersion: string;
  dryRun: boolean;
  installedCount: number;
  skippedCount: number;
  failedCount: number;
  blockedCount: number;
  actions: GamerDependencyInstallActionResult[];
  message: string;
  report: GamerDependencyVerificationReport;
};

export type GamerDependencyPreparedInstallResult = {
  downloadResult: GamerDependencyDownloadResult;
  installResult: GamerDependencyInstallResult;
  report: GamerDependencyVerificationReport;
};

export function gamerDependencyPreparationIssues(
  result: GamerDependencyPreparedInstallResult,
): string[] {
  if (result.installResult.dryRun) {
    return [];
  }

  const unresolvedPackages = result.report.packages.filter(
    (item) => !item.installedLocally && item.status !== "verified",
  );
  const failedActions = result.installResult.actions.filter(
    (item) => item.status === "failed" || item.status === "blocked",
  );
  const issues: string[] = [];

  if (result.downloadResult.failedCount > 0) {
    issues.push(`${result.downloadResult.failedCount} download(s) oficial(is) falharam`);
  }
  if (failedActions.length > 0) {
    issues.push(`${failedActions.length} instalação(ões) falharam ou foram bloqueadas`);
  }
  if (unresolvedPackages.length > 0) {
    issues.push(
      `${unresolvedPackages.length} dependência(s) continuam ausentes ou sem verificação`,
    );
  }

  return issues;
}

export type GamerDependencyInstallRequest = {
  confirmed: boolean;
  dryRun?: boolean;
  packageIds?: string[];
};

export type GamerDependencyVerifyRequest = {
  packageIds?: string[];
  packages: Array<{
    id: string;
    title: string;
    installerFileName: string;
    officialSourcePage: string;
    officialUrl?: string;
    expectedSha256?: string;
    requiredPublisher: "Microsoft Corporation";
  }>;
};

export type GamerDependencyReadiness = {
  summary: string;
  totalPackages: number;
  blockedCount: number;
  readyCount: number;
  detectedSummary: string;
  packages: GamerDependencyPackage[];
  installPlan: GamerDependencyInstallPlan;
  verification?: GamerDependencyVerificationReport;
  blockers: string[];
  excludedToolchain: GamerDependencyExcludedToolchainItem[];
};

export type GamerDependencyExcludedToolchainItem = {
  id: string;
  title: string;
  observedVersion?: string;
  policy: "neverAutoInstall";
  reason: string;
  relevantWhen: string;
};

const VCRUNTIME_YEARS = ["2005", "2008", "2010", "2012", "2013", "2015-2022"] as const;

export const GAMER_DEPENDENCY_PACKAGES: GamerDependencyPackage[] = [
  ...VCRUNTIME_YEARS.flatMap((year) => [vcRedist(year, "x86"), vcRedist(year, "x64")]),
  {
    id: "directx-end-user-runtime",
    title: "DirectX End-User Runtime",
    family: "directx",
    version: "legacy-runtime",
    architecture: "web",
    installerFileName: "dxwebsetup.exe",
    requiredPublisher: "Microsoft Corporation",
    installCommand: "dxwebsetup.exe /Q",
    officialSourcePage: "https://www.microsoft.com/en-us/download/details.aspx?id=35",
    officialUrl:
      "https://download.microsoft.com/download/1/7/1/1718ccc4-6315-4d8e-9543-8e28a4e18c4c/dxwebsetup.exe",
    expectedSha256: "2CF71D098C608C56E07F4655855A886C3102553F648DF88458DF616B26FD612F",
    officialSourceStatus: "downloadUrlVerified",
    expectedSha256Status: "requiredBeforeInstall",
    signatureStatus: "requiredBeforeInstall",
  },
];

export const GAMER_DEPENDENCY_EXCLUDED_TOOLCHAIN: GamerDependencyExcludedToolchainItem[] = [
  {
    id: "vs-build-tools-2022",
    title: "Ferramentas de Build do Visual Studio 2022",
    observedVersion: "17.14.33",
    policy: "neverAutoInstall",
    reason: "Toolchain de compilação pesada; não é runtime necessário para jogar.",
    relevantWhen: "Somente para desenvolvedores, compilação nativa ou projetos C++.",
  },
  {
    id: "visual-studio-installer",
    title: "Microsoft Visual Studio Installer",
    observedVersion: "4.6.58.48107",
    policy: "neverAutoInstall",
    reason:
      "Gerenciador de workloads do Visual Studio; não melhora FPS, latência ou estabilidade gamer.",
    relevantWhen: "Somente se o usuário quiser administrar instalações do Visual Studio.",
  },
  {
    id: "windows-sdk-addon",
    title: "Windows SDK AddOn",
    observedVersion: "10.1.0.0",
    policy: "neverAutoInstall",
    reason:
      "Componente de desenvolvimento do Windows SDK; fica fora do pacote gamer do cliente final.",
    relevantWhen: "Somente para desenvolvimento, depuração ou build de apps Windows.",
  },
  {
    id: "windows-sdk-26100",
    title: "Windows Software Development Kit",
    observedVersion: "10.0.26100.7705",
    policy: "neverAutoInstall",
    reason:
      "SDK completo do Windows é grande e não substitui DirectX End-User Runtime nem VC++ Redistributable.",
    relevantWhen: "Somente para desenvolvimento Windows, drivers ou ferramentas técnicas.",
  },
  {
    id: "vs-core-editor-fonts",
    title: "vs_CoreEditorFonts",
    observedVersion: "17.7.40001",
    policy: "neverAutoInstall",
    reason:
      "Fonte/asset do Visual Studio; sem benefício direto para jogos ou otimização do sistema.",
    relevantWhen: "Somente como dependência visual do ambiente Visual Studio.",
  },
  {
    id: "windows-app-runtime-main",
    title: "Windows App Runtime Main",
    policy: "neverAutoInstall",
    reason: "Runtime do Windows App SDK; só deve ser instalado quando um app específico exigir.",
    relevantWhen: "Somente por requisito explícito de outro aplicativo, não por otimização gamer.",
  },
];

export function buildGamerDependencyReadiness(
  advancedCatalog?: AdvancedCatalog,
  verification?: GamerDependencyVerificationReport,
): GamerDependencyReadiness {
  const installPlan = buildGamerDependencyInstallPlan();
  const dependencyCheck = advancedCatalog?.actions.find(
    (action) => action.id === "check-gamer-dependencies",
  );
  const detectedSummary =
    dependencyCheck?.currentValue && dependencyCheck.currentValue !== "Indisponível"
      ? dependencyCheck.currentValue
      : "Leitura local ainda não retornou VC++/DirectX.";
  const blockers = [
    "Downloads diretos legados seguem bloqueados até validação final da Microsoft.",
    "SHA256 esperado precisa ser preenchido antes de qualquer download/instalação.",
    "Assinatura Authenticode Microsoft precisa ser validada antes de executar.",
    "Build Tools, Visual Studio Installer, Windows SDK e Windows App Runtime ficam fora do pacote gamer automático.",
  ];
  const readyCount = verification?.readyCount ?? 0;
  const blockedCount = verification?.blockedCount ?? installPlan.blockedPackages;
  const summary = verification
    ? `${verification.totalPackages} dependência(s) gamer verificadas no cache; ${readyCount} pronta(s), ${blockedCount} bloqueada(s).`
    : `${GAMER_DEPENDENCY_PACKAGES.length} dependência(s) gamer mapeada(s); instalação bloqueada até hash e assinatura.`;

  return {
    summary,
    totalPackages: GAMER_DEPENDENCY_PACKAGES.length,
    blockedCount,
    readyCount,
    detectedSummary,
    packages: GAMER_DEPENDENCY_PACKAGES,
    installPlan,
    verification,
    blockers,
    excludedToolchain: GAMER_DEPENDENCY_EXCLUDED_TOOLCHAIN,
  };
}

export function buildGamerDependencyInstallPlan(): GamerDependencyInstallPlan {
  const queue = GAMER_DEPENDENCY_PACKAGES.map((item) => {
    const manifestReady = isGamerDependencyManifestReady(item);

    return {
      packageId: item.id,
      title: item.title,
      installerFileName: item.installerFileName,
      installCommand: item.installCommand,
      manifestReady,
      blocked: !manifestReady,
      blockedReason: manifestReady
        ? undefined
        : "Aguardando SHA256 esperado, assinatura Authenticode e checagem local antes de instalar.",
      requiredChecks: [
        "Fonte oficial Microsoft",
        "Hash SHA256 esperado",
        "Assinatura Authenticode: Microsoft Corporation",
        "Detecção local para evitar reinstalação desnecessária",
      ],
    };
  });
  const approvedPackages = queue.filter((item) => item.manifestReady).length;
  const blockedPackages = queue.length - approvedPackages;

  return {
    totalPackages: queue.length,
    approvedPackages,
    blockedPackages,
    canExecute: approvedPackages > 0,
    queue,
  };
}

export function buildGamerDependencyVerifyRequest(): GamerDependencyVerifyRequest {
  return {
    packages: GAMER_DEPENDENCY_PACKAGES.map((item) => ({
      id: item.id,
      title: item.title,
      installerFileName: item.installerFileName,
      officialSourcePage: item.officialSourcePage,
      officialUrl: item.officialUrl,
      expectedSha256: item.expectedSha256,
      requiredPublisher: item.requiredPublisher,
    })),
  };
}

export function approvedGamerDependencyPackageIds() {
  return GAMER_DEPENDENCY_PACKAGES.filter(isGamerDependencyManifestReady).map((item) => item.id);
}

export function buildGamerDependencyDownloadPayload(): GamerDependencyVerifyRequest {
  return {
    ...buildGamerDependencyVerifyRequest(),
    packageIds: approvedGamerDependencyPackageIds(),
  };
}

export function buildGamerDependencyInstallPayload(request: GamerDependencyInstallRequest) {
  return {
    ...forceSafeDryRun(request),
    packageIds: request.packageIds ?? approvedGamerDependencyPackageIds(),
    packages: buildGamerDependencyVerifyRequest().packages,
  };
}

export function isGamerDependencyManifestReady(item: GamerDependencyPackage) {
  return Boolean(
    item.officialUrl &&
    /^https:\/\/(aka\.ms\/|www\.microsoft\.com\/|download\.microsoft\.com\/)/i.test(
      item.officialUrl,
    ) &&
    item.expectedSha256 &&
    /^[a-f0-9]{64}$/i.test(item.expectedSha256),
  );
}

export async function verifyGamerDependencyInstallers(): Promise<GamerDependencyVerificationReport> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return fallbackGamerDependencyVerificationReport();
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<GamerDependencyVerificationReport>("gamer_dependency_verify_installers", {
      request: buildGamerDependencyVerifyRequest(),
    });
  } catch (error) {
    console.warn("Verificador de dependências gamer indisponível.", error);
    return {
      ...fallbackGamerDependencyVerificationReport(),
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function openGamerDependencyCacheDir(): Promise<string> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error("Cache de instaladores disponivel apenas no aplicativo NEXT.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<string>("gamer_dependency_open_cache_dir");
}

export async function downloadOfficialGamerDependencyInstallers(): Promise<GamerDependencyDownloadResult> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error("Download oficial disponivel apenas no aplicativo NEXT.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<GamerDependencyDownloadResult>(
    "gamer_dependency_download_official_installers",
    {
      request: buildGamerDependencyDownloadPayload(),
    },
  );
}

export async function auditOfficialGamerDependencyManifest(): Promise<GamerDependencyManifestAuditResult> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error("Auditoria oficial disponivel apenas no aplicativo NEXT.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<GamerDependencyManifestAuditResult>(
    "gamer_dependency_audit_official_manifest",
    {
      request: buildGamerDependencyVerifyRequest(),
    },
  );
}

export async function installVerifiedGamerDependencies(
  request: GamerDependencyInstallRequest,
): Promise<GamerDependencyInstallResult> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    throw new Error("Instalador gamer disponivel apenas no aplicativo NEXT.");
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<GamerDependencyInstallResult>("gamer_dependency_install_verified", {
    request: buildGamerDependencyInstallPayload(request),
  });
}

export async function prepareAndInstallVerifiedGamerDependencies(
  request: GamerDependencyInstallRequest,
): Promise<GamerDependencyPreparedInstallResult> {
  if (request.dryRun) {
    const installResult = await installVerifiedGamerDependencies(request);
    const downloadResult: GamerDependencyDownloadResult = {
      downloadedCount: 0,
      skippedCount: GAMER_DEPENDENCY_PACKAGES.length,
      failedCount: 0,
      messages: ["Modo teste: nenhum download foi iniciado."],
      report: installResult.report,
    };

    return {
      downloadResult,
      installResult,
      report: installResult.report,
    };
  }

  const downloadResult = await downloadOfficialGamerDependencyInstallers();
  const installResult = await installVerifiedGamerDependencies(request);

  return {
    downloadResult,
    installResult,
    report: installResult.report,
  };
}

export function isGamerDependencyInstallerAction(actionId: string) {
  return (
    actionId.startsWith("vc-redist-") ||
    actionId === "directx-runtime" ||
    actionId === "directx-end-user-runtime"
  );
}

function fallbackGamerDependencyVerificationReport(): GamerDependencyVerificationReport {
  return {
    generatedAt: "0",
    engineVersion: "gamer-dependencies-verifier-fallback-v1",
    cacheDir: "Indisponível fora do backend Tauri",
    totalPackages: GAMER_DEPENDENCY_PACKAGES.length,
    readyCount: 0,
    installedLocallyCount: 0,
    blockedCount: GAMER_DEPENDENCY_PACKAGES.length,
    packages: GAMER_DEPENDENCY_PACKAGES.map((item) => ({
      packageId: item.id,
      title: item.title,
      installerFileName: item.installerFileName,
      officialSourcePage: item.officialSourcePage,
      officialUrl: item.officialUrl,
      cachedPath: "Indisponível",
      fileExists: false,
      installedLocally: false,
      status: "missing",
      expectedSha256: item.expectedSha256,
      blockedReasons: ["Verificação real disponível apenas no aplicativo Tauri."],
    })),
    warnings: ["Verificador real indisponível fora do backend Tauri."],
  };
}

function vcRedist(
  year: (typeof VCRUNTIME_YEARS)[number],
  architecture: "x86" | "x64",
): GamerDependencyPackage {
  const normalizedYear = year.replace("-", "_");
  const source = vcRedistSource(year, architecture);

  return {
    id: `vc-redist-${year}-${architecture}`,
    title: `Microsoft Visual C++ ${year} Redistributable ${architecture}`,
    family: "vcredist",
    version: year,
    architecture,
    installerFileName: `vcredist_${normalizedYear}_${architecture}.exe`,
    officialSourcePage: source.sourcePage,
    officialUrl: source.downloadUrl,
    expectedSha256: source.expectedSha256,
    requiredPublisher: "Microsoft Corporation",
    installCommand: `vcredist_${normalizedYear}_${architecture}.exe /quiet /norestart`,
    officialSourceStatus: source.downloadUrl ? "downloadUrlVerified" : "sourcePageVerified",
    expectedSha256Status: "requiredBeforeInstall",
    signatureStatus: "requiredBeforeInstall",
  };
}

function vcRedistSource(
  year: (typeof VCRUNTIME_YEARS)[number],
  architecture: "x86" | "x64",
): { sourcePage: string; downloadUrl?: string; expectedSha256?: string } {
  const learnPage =
    "https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170";

  if (year === "2015-2022") {
    return {
      sourcePage: learnPage,
      downloadUrl: `https://aka.ms/vc14/vc_redist.${architecture}.exe`,
      expectedSha256:
        architecture === "x64"
          ? "843068991DAAA1F73AD9F6239BCE4D0F6A07A51F18C37EA2A867E9BECA71295C"
          : "F0BAB33A302B3CDB2E11113760D016F54FD3D2632C65BA7834FAC4F0ABD7F1A3",
    };
  }

  if (year === "2012") {
    return {
      sourcePage: "https://www.microsoft.com/en-us/download/details.aspx?id=30679",
      downloadUrl:
        architecture === "x64"
          ? "https://download.microsoft.com/download/1/6/b/16b06f60-3b20-4ff2-b699-5e9b7962f9ae/VSU_4/vcredist_x64.exe"
          : "https://download.microsoft.com/download/1/6/b/16b06f60-3b20-4ff2-b699-5e9b7962f9ae/VSU_4/vcredist_x86.exe",
      expectedSha256:
        architecture === "x64"
          ? "681BE3E5BA9FD3DA02C09D7E565ADFA078640ED66A0D58583EFAD2C1E3CC4064"
          : "B924AD8062EAF4E70437C8BE50FA612162795FF0839479546CE907FFA8D6E386",
    };
  }

  if (year === "2010") {
    return {
      sourcePage: "https://www.microsoft.com/en-us/download/details.aspx?id=26999",
      downloadUrl:
        architecture === "x64"
          ? "https://download.microsoft.com/download/1/6/5/165255e7-1014-4d0a-b094-b6a430a6bffc/vcredist_x64.exe"
          : "https://download.microsoft.com/download/1/6/5/165255e7-1014-4d0a-b094-b6a430a6bffc/vcredist_x86.exe",
      expectedSha256:
        architecture === "x64"
          ? "F3B7A76D84D23F91957AA18456A14B4E90609E4CE8194C5653384ED38DADA6F3"
          : "99DCE3C841CC6028560830F7866C9CE2928C98CF3256892EF8E6CF755147B0D8",
    };
  }

  if (year === "2008") {
    return {
      sourcePage: "https://www.microsoft.com/en-us/download/details.aspx?id=11895",
      downloadUrl:
        architecture === "x64"
          ? "https://download.microsoft.com/download/9/7/7/977b481a-7ba6-4e30-ac40-ed51eb2028f2/vcredist_x64.exe"
          : "https://download.microsoft.com/download/9/7/7/977b481a-7ba6-4e30-ac40-ed51eb2028f2/vcredist_x86.exe",
      expectedSha256:
        architecture === "x64"
          ? "06ABF71E4B4CFC446D311ED12BAD2266139DF6901820B23BA44FC3038F40365F"
          : "1336C1B517CB9384DC86300C934A58D5902205A6DC846D2E2F517E4C139B56C7",
    };
  }

  if (year === "2013") {
    return {
      sourcePage: "https://www.microsoft.com/en-us/download/details.aspx?id=40784",
      downloadUrl:
        architecture === "x64"
          ? "https://download.microsoft.com/download/2/e/6/2e61cfa4-993b-4dd4-91da-3737cd5cd6e3/vcredist_x64.exe"
          : "https://download.microsoft.com/download/2/e/6/2e61cfa4-993b-4dd4-91da-3737cd5cd6e3/vcredist_x86.exe",
      expectedSha256:
        architecture === "x64"
          ? "E554425243E3E8CA1CD5FE550DB41E6FA58A007C74FAD400274B128452F38FB8"
          : "A22895E55B26202EAE166838EDBE2EA6AAD00D7EA600C11F8A31EDE5CBCE2048",
    };
  }

  return {
    sourcePage: "https://www.microsoft.com/en-us/download/details.aspx?id=26347",
    downloadUrl:
      architecture === "x64"
        ? "https://download.microsoft.com/download/8/b/4/8b42259f-5d70-43f4-ac2e-4b208fd8d66a/vcredist_x64.EXE"
        : "https://download.microsoft.com/download/8/b/4/8b42259f-5d70-43f4-ac2e-4b208fd8d66a/vcredist_x86.EXE",
    expectedSha256:
      architecture === "x64"
        ? "4487570BD86E2E1AAC29DB2A1D0A91EB63361FCAAC570808EB327CD4E0E2240D"
        : "8648C5FC29C44B9112FE52F9A33F80E7FC42D10F3B5B42B2121542A13E44ADFD",
  };
}
