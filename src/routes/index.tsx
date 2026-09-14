import { createFileRoute, Link } from "@tanstack/react-router";
import {
  type LucideIcon,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Gamepad2,
  HardDrive,
  Heart,
  Info,
  MemoryStick,
  Monitor,
  RefreshCw,
  Shield,
  Thermometer,
  Wifi,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { HealthRing } from "@/components/dashboard/HealthRing";
import { MetricCard, ProgressBar, Sparkline } from "@/components/dashboard/MetricCard";
import { InfoPanel, InfoRow, HwRow, RecRow } from "@/components/dashboard/InfoPanel";
import {
  fallbackAdvisorRecommendations,
  loadAdvisorRecommendations,
  type AdvisorRecommendation,
} from "@/lib/advisor";
import {
  advisorInputFromDiagnostic,
  fallbackDiagnosticReport,
  loadDiagnosticReport,
  refreshLiveDiagnosticReport,
  type DiagnosticReport,
} from "@/lib/diagnostic";
import {
  HermesArchitectureIcon,
  HermesClockIcon,
  HermesCollectionIcon,
  HermesComputerIcon,
  HermesCpuIcon,
  HermesDiskIcon,
  HermesGpuIcon,
  HermesMotherboardIcon,
  HermesRamIcon,
  HermesVersionIcon,
  HermesWindowsIcon,
} from "@/components/dashboard/HermesPanelIcons";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NEXT Optimizer — Dashboard" },
      { name: "description", content: "Painel central do PC com coleta local somente leitura." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const [diagnostic, setDiagnostic] = useState<DiagnosticReport>(fallbackDiagnosticReport);
  const [recommendations, setRecommendations] = useState<AdvisorRecommendation[]>(
    fallbackAdvisorRecommendations,
  );

  useEffect(() => {
    let mounted = true;
    const applyLiveReport = async (report: DiagnosticReport) => {
      if (!mounted) {
        return;
      }

      setDiagnostic(report);
      const items = await loadAdvisorRecommendations(advisorInputFromDiagnostic(report));
      if (mounted) {
        setRecommendations(items);
      }
    };

    void loadDiagnosticReport()
      .then((report) => {
        if (mounted) {
          setDiagnostic(report);
        }
      })
      .then(() => refreshLiveDiagnosticReport())
      .then(applyLiveReport);

    return () => {
      mounted = false;
    };
  }, []);

  const healthScore = Math.round(diagnostic.healthScore);
  const healthSub = `${diagnostic.healthLabel} • ${diagnostic.defender.active ? "Sistema protegido" : "Verificar segurança"}`;
  const cpuUsage = Math.round(diagnostic.cpu.usagePercent);
  const ramUsage = Math.round(diagnostic.ram.usedPercent);
  const diskUsage = Math.round(diagnostic.disk.usedPercent);
  const startupImpact = getStartupImpactLabel(diagnostic);
  const updateStatus = diagnostic.windowsUpdate.status;
  const displayHz = formatHz(diagnostic.display.refreshRateHz);
  const gpuValue = formatGpuName(diagnostic.gpu.name);
  const gpuSub = formatGpuSub(diagnostic.gpu);
  const temperatureValue = formatTemperatureValue(diagnostic.temperature);
  const temperatureSub = formatTemperatureSub(diagnostic.temperature);
  const wifiSub = formatWifiSub(diagnostic.network);
  const pingValue =
    typeof diagnostic.network.pingMs === "number"
      ? formatPing(diagnostic.network.pingMs)
      : "Indisp.";
  const temperatureText =
    diagnostic.temperature.available && typeof diagnostic.temperature.celsius === "number"
      ? ` • ${formatNumber(diagnostic.temperature.celsius)}°C`
      : "";

  return (
    <div className="lightning-bg flex h-screen overflow-hidden">
      <Sidebar />

      <div className="flex min-h-0 flex-1 flex-col min-w-0">
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 xl:px-8 xl:py-4">
          <div className="mx-auto grid min-h-full w-full max-w-[1540px] grid-rows-[auto_auto_auto_auto_auto]">
            {/* Header */}
            <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="relative min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-card/45 px-4 py-2.5 shadow-[0_14px_42px_-36px_rgba(168,85,247,0.7)] backdrop-blur xl:max-w-[520px]">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(216,180,254,0.14),transparent_30%),linear-gradient(120deg,rgba(255,255,255,0.05),transparent_54%)]" />
                <div className="relative flex min-h-[68px] flex-col justify-center">
                  <span className="inline-flex h-4 w-fit items-center rounded-full border border-primary/25 bg-primary/10 px-2 text-[7px] font-black uppercase tracking-[0.18em] text-primary">
                    Command Center
                  </span>
                  <h1 className="mt-1.5 bg-gradient-to-r from-white via-fuchsia-100 to-primary bg-clip-text text-[clamp(23px,1.8vw,29px)] font-black leading-none tracking-normal text-transparent drop-shadow-[0_0_16px_rgba(168,85,247,0.18)]">
                    Dashboard Engine
                  </h1>
                  <p className="mt-1.5 max-w-lg truncate text-[10.5px] leading-relaxed text-muted-foreground">
                    Status central do PC com coleta local. O Dashboard acompanha a máquina; a área
                    Otimizar cuida do plano guiado.
                  </p>
                </div>
              </div>
              <div className="relative flex w-full max-w-[330px] items-center justify-between gap-3 overflow-hidden rounded-2xl border border-white/10 bg-card/82 px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.18),0_16px_34px_-24px_rgba(168,85,247,0.5)] backdrop-blur xl:w-[330px]">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.1] via-transparent to-primary/14 opacity-70" />
                <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
                  <Shield
                    className="absolute inset-0 h-full w-full fill-white/5 text-white/45 drop-shadow-[0_0_16px_rgba(216,180,254,0.34)]"
                    strokeWidth={1.6}
                  />
                  <Zap className="relative h-5 w-5 fill-white text-white drop-shadow-[0_0_14px_rgba(216,180,254,0.75)]" />
                </div>
                <div className="relative min-w-0 flex-1 text-left">
                  <p className="text-[9px] font-bold tracking-wider text-muted-foreground">
                    SAÚDE GERAL
                  </p>
                  <p className="mt-1 text-[21px] font-semibold leading-none text-foreground">
                    {healthScore}
                    <span className="text-xs font-medium text-muted-foreground">/100</span>
                  </p>
                  <p className="mt-1 truncate text-[9px] text-muted-foreground">{healthSub}</p>
                </div>
                <div className="relative">
                  <HealthRing value={healthScore} size={62} stroke={6} />
                </div>
              </div>
            </div>

            {/* Metrics row */}
            <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={Heart}
                label="Saúde geral"
                value={`${healthScore}/100`}
                sub={healthSub}
              >
                <Sparkline />
              </MetricCard>
              <MetricCard
                icon={Cpu}
                label="CPU"
                value={`${cpuUsage}%`}
                footer={
                  <>
                    {diagnostic.cpu.name}
                    <br />
                    {diagnostic.cpu.logicalProcessors} threads •{" "}
                    {formatGhz(diagnostic.cpu.currentClockMhz)}
                  </>
                }
              >
                <ProgressBar value={cpuUsage} gradient="from-primary to-info" />
              </MetricCard>
              <MetricCard
                icon={MemoryStick}
                label="RAM"
                value={`${ramUsage}%`}
                footer={
                  <>
                    {formatGb(diagnostic.ram.usedGb)} GB usados • {formatGb(diagnostic.ram.freeGb)}{" "}
                    GB livres
                    <br />
                    Total {formatGb(diagnostic.ram.totalGb)} GB
                  </>
                }
              >
                <ProgressBar value={ramUsage} gradient="from-primary to-purple-accent" />
              </MetricCard>
              <MetricCard
                icon={HardDrive}
                label={`Disco principal (${diagnostic.disk.mount})`}
                value={`${diskUsage}%`}
                footer={
                  <>
                    {formatGb(diagnostic.disk.freeGb)} GB livres de{" "}
                    {formatGb(diagnostic.disk.totalGb)} GB
                    <br />
                    {diagnostic.disk.mediaType} • {diagnostic.disk.healthStatus}
                  </>
                }
              >
                <ProgressBar value={diskUsage} gradient="from-info to-primary" />
              </MetricCard>
            </div>

            {/* Three panels */}
            <div className="mb-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(300px,0.9fr)]">
              <InfoPanel title="SISTEMA">
                <InfoRow
                  icon={HermesComputerIcon}
                  label="Computador:"
                  value={diagnostic.system.computerName}
                />
                <InfoRow
                  icon={HermesWindowsIcon}
                  label="Sistema:"
                  value={diagnostic.system.osName}
                />
                <InfoRow
                  icon={HermesVersionIcon}
                  label="Versão:"
                  value={`${diagnostic.system.osVersion} (Build ${diagnostic.system.osBuild})`}
                />
                <InfoRow
                  icon={HermesArchitectureIcon}
                  label="Arquitetura:"
                  value={diagnostic.system.architecture}
                />
                <InfoRow
                  icon={HermesClockIcon}
                  label="Tempo ligado:"
                  value={diagnostic.uptime.label}
                />
                <InfoRow
                  icon={HermesCollectionIcon}
                  label="Coleta:"
                  value="Somente leitura (local)"
                />
              </InfoPanel>

              <InfoPanel title="HARDWARE DETALHADO">
                <HwRow
                  icon={HermesCpuIcon}
                  label="CPU"
                  primary={diagnostic.cpu.name}
                  secondary={`${diagnostic.cpu.physicalCores} núcleos • ${diagnostic.cpu.logicalProcessors} threads${temperatureText}`}
                />
                <HwRow
                  icon={HermesRamIcon}
                  label="MEMÓRIA RAM"
                  primary={`${formatGb(diagnostic.ram.totalGb)} GB RAM`}
                  secondary={`${formatGb(diagnostic.ram.usedGb)} GB usados (${ramUsage}%)`}
                />
                <HwRow
                  icon={HermesGpuIcon}
                  label="GPU"
                  primary={diagnostic.gpu.name}
                  secondary={`Driver ${diagnostic.gpu.driverVersion}`}
                />
                <HwRow
                  icon={HermesDiskIcon}
                  label="DISCO PRINCIPAL"
                  primary={diagnostic.disk.physicalName}
                  secondary={`${diagnostic.disk.mediaType} • ${formatGb(diagnostic.disk.totalGb)} GB • ${diskUsage}% usado`}
                />
                <HwRow
                  icon={HermesMotherboardIcon}
                  label="PLACA-MÃE"
                  primary={`Fabricante: ${diagnostic.system.motherboardManufacturer}`}
                  secondary={`Modelo: ${diagnostic.system.motherboardModel}`}
                />
              </InfoPanel>

              <InfoPanel title="RECOMENDAÇÕES NEXT">
                {recommendations.map((recommendation) => {
                  const visual = getRecommendationVisual(recommendation);
                  return (
                    <RecRow
                      key={recommendation.id}
                      icon={visual.icon}
                      color={visual.color}
                      title={recommendation.title}
                      desc={recommendation.description}
                    />
                  );
                })}
                <Link
                  to="/otimizar"
                  className="mt-2 flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  Ir para otimizar →
                </Link>
              </InfoPanel>
            </div>

            {/* Status bar */}
            <div className="rounded-2xl border border-border/45 bg-card/75 p-2 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_10px_28px_-24px_rgba(15,23,42,0.18)]">
              <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
                <StatusItem
                  icon={Monitor}
                  label="MONITOR"
                  value={displayHz}
                  sub={diagnostic.display.resolution}
                />
                <StatusItem icon={Gamepad2} label="GPU" value={gpuValue} sub={gpuSub} />
                <StatusItem
                  icon={Thermometer}
                  label="TEMPERATURA"
                  value={temperatureValue}
                  sub={temperatureSub}
                />
                <StatusItem
                  icon={Wifi}
                  label="WI-FI"
                  value={diagnostic.network.ssid}
                  sub={wifiSub}
                />
                <StatusItem
                  icon={Activity}
                  label="PING"
                  value={pingValue}
                  sub={diagnostic.network.pingStatus}
                />
              </div>
            </div>

            <div className="hidden">
              <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <StatusItem
                  icon={Zap}
                  label="INICIALIZAÇÃO"
                  value={`${diagnostic.startup.totalItems} itens`}
                  sub={`${startupImpact} impacto`}
                />
                <StatusItem
                  icon={Clock}
                  label="UPTIME"
                  value={diagnostic.uptime.label}
                  sub="Sistema estável"
                />
                <StatusItem
                  icon={Shield}
                  label="SEGURANÇA"
                  value={diagnostic.defender.status}
                  sub="Windows Defender"
                />
                <StatusItem
                  icon={RefreshCw}
                  label="ATUALIZAÇÕES"
                  value={updateStatus}
                  sub={diagnostic.windowsUpdate.lastHotfixId}
                />
              </div>
            </div>

            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              NEXT Optimizer 0.1.0 • Local first • Ações reais somente com confirmação
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

function StatusItem({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft">
        <Icon className="h-[18px] w-[18px] text-primary" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold tracking-wider text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold leading-tight text-foreground">{value}</p>
        <p className="text-[10px] text-muted-foreground truncate">{sub}</p>
      </div>
    </div>
  );
}

function getRecommendationVisual(recommendation: AdvisorRecommendation) {
  if (recommendation.category === "hardware") {
    return { icon: Gamepad2, color: "bg-purple-accent/15 text-purple-accent" };
  }

  if (recommendation.category === "profile") {
    return { icon: Gamepad2, color: "bg-purple-accent/15 text-purple-accent" };
  }

  if (recommendation.category === "cleanup") {
    return { icon: Zap, color: "bg-primary/15 text-primary" };
  }

  if (recommendation.category === "power") {
    return { icon: Zap, color: "bg-info/15 text-info" };
  }

  if (recommendation.severity === "success") {
    return { icon: CheckCircle2, color: "bg-success/15 text-success" };
  }

  if (recommendation.severity === "warning") {
    return { icon: AlertTriangle, color: "bg-warning/15 text-warning" };
  }

  return { icon: Info, color: "bg-info/15 text-info" };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "data indisponível";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatGb(value: number) {
  return formatNumber(value);
}

function formatGhz(clockMhz: number) {
  if (!clockMhz || clockMhz <= 0) {
    return "clock indisponível";
  }

  return `${formatNumber(clockMhz / 1000)} GHz`;
}

function formatHz(refreshRateHz?: number) {
  if (!refreshRateHz || refreshRateHz <= 0) {
    return "Indisp.";
  }

  return `${formatNumber(refreshRateHz)} Hz`;
}

function formatGpuName(name: string) {
  const normalized = name
    .replace(/\(R\)|\(TM\)/g, "")
    .replace(/\s+Graphics\b/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized || /nao identificada|não identificada/i.test(normalized)) {
    return "Indisp.";
  }

  return normalized.length > 18 ? `${normalized.slice(0, 18).trim()}...` : normalized;
}

function formatGpuSub(gpu: DiagnosticReport["gpu"]) {
  if (typeof gpu.adapterRamGb === "number" && gpu.adapterRamGb > 0) {
    return `${formatGb(gpu.adapterRamGb)} GB VRAM`;
  }

  return "Driver local";
}

function formatTemperatureValue(temperature: DiagnosticReport["temperature"]) {
  if (!temperature.available || typeof temperature.celsius !== "number") {
    return "Indisp.";
  }

  return `${formatNumber(temperature.celsius)}°C`;
}

function formatTemperatureSub(temperature: DiagnosticReport["temperature"]) {
  if (!temperature.available) {
    return "Sensor indisponível";
  }

  return temperature.status;
}

function formatPing(pingMs: number) {
  if (typeof pingMs !== "number" || pingMs < 0) {
    return "Indisp.";
  }

  return `${formatNumber(pingMs)} ms`;
}

function formatWifiSub(network: DiagnosticReport["network"]) {
  if (network.signalPercent !== undefined) {
    return `${network.status} • ${network.signalPercent}%`;
  }

  return network.status;
}

function getStartupImpactLabel(report: DiagnosticReport) {
  if (report.startup.highImpactCount >= 3 || report.startup.totalItems >= 25) {
    return "Alto";
  }

  if (report.startup.highImpactCount >= 1 || report.startup.totalItems >= 10) {
    return "Médio";
  }

  return "Baixo";
}
