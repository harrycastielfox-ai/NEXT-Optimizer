import { readLocalReportCache, writeLocalReportCache } from "@/lib/local-read-cache";

export type AdvisorAiSourceStatus = "available" | "partial" | "unavailable";
export type AdvisorAiConfidence = "low" | "medium" | "high";
export type AdvisorAiSeverity = "critical" | "high" | "medium" | "low" | "informational";
export type AdvisorAiCategory =
  | "system"
  | "startup"
  | "cleanup"
  | "benchmark"
  | "memory"
  | "disk"
  | "performance"
  | "security"
  | "gamer"
  | "restore"
  | "profile";
export type AdvisorAiScoreStatus = "available" | "partial" | "unavailable";

export type HermesScoreComponent = {
  id: string;
  label: string;
  weight: number;
  value: number | null;
  status: AdvisorAiScoreStatus;
  sourceId: string;
  explanation: string;
};

export type HermesScore = {
  value: number | null;
  label: string;
  status: AdvisorAiScoreStatus;
  confidence: AdvisorAiConfidence;
  coveragePercent: number;
  explanation: string;
  components: HermesScoreComponent[];
};

export type AdvisorAiSummary = {
  generalState: string;
  problemCount: number;
  recommendationCount: number;
  recommendedProfile: string | null;
  recommendedProfileReason: string;
  confidence: AdvisorAiConfidence;
};

export type AdvisorAiFinding = {
  id: string;
  title: string;
  explanation: string;
  severity: AdvisorAiSeverity;
  category: AdvisorAiCategory;
  impactEstimate: string;
  sourceIds: string[];
  confidence: AdvisorAiConfidence;
};

export type AdvisorAiRecommendation = {
  id: string;
  title: string;
  description: string;
  severity: AdvisorAiSeverity;
  category: AdvisorAiCategory;
  suggestedProfile: string | null;
  userDecisionRequired: boolean;
  canApplyAutomatically: boolean;
  sourceIds: string[];
  confidence: AdvisorAiConfidence;
};

export type AdvisorAiSource = {
  id: string;
  label: string;
  status: AdvisorAiSourceStatus;
  confidence: AdvisorAiConfidence;
  detail: string;
  warnings: string[];
};

export type AdvisorAiHistorySummary = {
  diagnosticReports: number;
  benchmarkReports: number;
  advisorReports: number;
  optimizePlans: number;
  snapshots: number;
  logs: number;
};

export type AdvisorAiReport = {
  generatedAt: string;
  engineVersion: string;
  readOnly: boolean;
  willModifySystem: boolean;
  offline: boolean;
  telemetry: boolean;
  chatbot: boolean;
  hermesScore: HermesScore;
  summary: AdvisorAiSummary;
  findings: AdvisorAiFinding[];
  recommendations: AdvisorAiRecommendation[];
  sources: AdvisorAiSource[];
  unavailableData: string[];
  history: AdvisorAiHistorySummary;
  safeguards: string[];
};

export const unavailableAdvisorAiReport: AdvisorAiReport = {
  generatedAt: "0",
  engineVersion: "advisor-ai-engine-unavailable-v1",
  readOnly: true,
  willModifySystem: false,
  offline: true,
  telemetry: false,
  chatbot: false,
  hermesScore: {
    value: null,
    label: "Indisponível",
    status: "unavailable",
    confidence: "low",
    coveragePercent: 0,
    explanation: "NEXT Insight exige o backend Tauri local para analisar dados reais.",
    components: [],
  },
  summary: {
    generalState: "Análise indisponível",
    problemCount: 0,
    recommendationCount: 0,
    recommendedProfile: null,
    recommendedProfileReason: "Sem dados reais disponíveis para recomendar perfil.",
    confidence: "low",
  },
  findings: [],
  recommendations: [],
  sources: [],
  unavailableData: ["Backend Tauri local indisponível."],
  history: {
    diagnosticReports: 0,
    benchmarkReports: 0,
    advisorReports: 0,
    optimizePlans: 0,
    snapshots: 0,
    logs: 0,
  },
  safeguards: [
    "Fallback seguro sem dados inventados.",
    "Nenhuma ação e aplicada.",
    "Nenhum dado e enviado para nuvem.",
  ],
};

export async function loadAdvisorAiReport(): Promise<AdvisorAiReport> {
  const cached = readLocalReportCache<AdvisorAiReport>("advisor-ai-report");
  if (cached) {
    return cached;
  }

  return refreshAdvisorAiReport();
}

export async function refreshAdvisorAiReport(): Promise<AdvisorAiReport> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
    return unavailableAdvisorAiReport;
  }

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const report = await invoke<AdvisorAiReport>("advisor_ai_engine_analyze");
    return writeLocalReportCache("advisor-ai-report", report);
  } catch (error) {
    console.warn("NEXT Insight local indisponível.", error);
    return {
      ...unavailableAdvisorAiReport,
      unavailableData: ["NEXT Insight local indisponível no backend Tauri."],
    };
  }
}
