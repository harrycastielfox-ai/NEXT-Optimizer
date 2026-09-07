use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const MAX_ADVISOR_REPORTS: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSnapshot {
    pub health_score: u8,
    pub cpu_usage_percent: f32,
    pub ram_used_gb: f32,
    pub ram_total_gb: f32,
    pub disk_free_gb: f32,
    pub disk_total_gb: f32,
    pub startup_items_count: u32,
    pub startup_high_impact_count: u32,
    pub boot_time_seconds: Option<u32>,
    pub security_active: bool,
    pub temporary_files_gb: Option<f32>,
    pub power_plan_name: Option<String>,
}

impl Default for DiagnosticSnapshot {
    fn default() -> Self {
        Self {
            health_score: 0,
            cpu_usage_percent: 0.0,
            ram_used_gb: 0.0,
            ram_total_gb: 0.0,
            disk_free_gb: 0.0,
            disk_total_gb: 0.0,
            startup_items_count: 0,
            startup_high_impact_count: 0,
            boot_time_seconds: None,
            security_active: false,
            temporary_files_gb: None,
            power_plan_name: Some("Indisponivel".to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkSnapshot {
    pub score: u32,
    pub previous_score: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorInput {
    pub diagnostic: DiagnosticSnapshot,
    pub benchmark: Option<BenchmarkSnapshot>,
}

impl Default for AdvisorInput {
    fn default() -> Self {
        Self {
            diagnostic: DiagnosticSnapshot::default(),
            benchmark: Some(BenchmarkSnapshot {
                score: 0,
                previous_score: None,
            }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecommendationSeverity {
    Success,
    Info,
    Warning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecommendationCategory {
    SystemHealth,
    Startup,
    Disk,
    Benchmark,
    Boot,
    Memory,
    Cpu,
    Security,
    Cleanup,
    Power,
    Profile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorRecommendation {
    pub id: String,
    pub title: String,
    pub description: String,
    pub severity: RecommendationSeverity,
    pub category: RecommendationCategory,
    pub priority: u8,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorReport {
    pub generated_at: String,
    pub engine_version: String,
    pub read_only: bool,
    pub summary: AdvisorReportSummary,
    pub recommendations: Vec<AdvisorRecommendation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorReportSummary {
    pub health_score: u8,
    pub benchmark_score: Option<u32>,
    pub boot_time_seconds: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct AdvisorHistory {
    reports: Vec<AdvisorReport>,
}

#[tauri::command]
pub fn advisor_pro_analyze(
    app: AppHandle,
    input: Option<AdvisorInput>,
) -> Result<AdvisorReport, String> {
    let input = input.unwrap_or_default();
    let history_path = advisor_history_path(&app)?;
    let mut history = read_history(&history_path);
    let report = build_smart_report(&input, history.reports.first());

    history.reports.insert(0, report.clone());
    history.reports.truncate(MAX_ADVISOR_REPORTS);
    write_history(&history_path, &history)?;

    Ok(report)
}

fn build_smart_report(
    input: &AdvisorInput,
    previous_report: Option<&AdvisorReport>,
) -> AdvisorReport {
    let mut recommendations = Vec::new();
    let diagnostic = &input.diagnostic;

    let disk_used_percent = safe_percent(
        diagnostic.disk_total_gb - diagnostic.disk_free_gb,
        diagnostic.disk_total_gb,
    );
    let disk_free_percent = safe_percent(diagnostic.disk_free_gb, diagnostic.disk_total_gb);
    let ram_used_percent = safe_percent(diagnostic.ram_used_gb, diagnostic.ram_total_gb);
    let temporary_files_gb = diagnostic.temporary_files_gb.unwrap_or_default().max(0.0);
    let power_plan_name = diagnostic
        .power_plan_name
        .as_deref()
        .unwrap_or("Desconhecido");
    let power_plan_is_balanced = is_balanced_power_plan(power_plan_name);

    if !diagnostic.security_active {
        recommendations.push(rec(
            "security-inactive",
            "Protecao do sistema desativada",
            "A seguranca do Windows parece inativa. Ative a protecao antes de aplicar otimizacoes.",
            RecommendationSeverity::Warning,
            RecommendationCategory::Security,
            10,
            "diagnostico de seguranca",
        ));
    }

    if let Some(benchmark) = &input.benchmark {
        if let Some(previous_score) = benchmark
            .previous_score
            .or_else(|| previous_benchmark_score(previous_report))
        {
            if previous_score > 0 {
                let drop_percent = ((previous_score as f32 - benchmark.score as f32)
                    / previous_score as f32)
                    * 100.0;
                if drop_percent >= 5.0 {
                    recommendations.push(rec(
                        "benchmark-drop",
                        "Benchmark caiu",
                        format!(
                            "Seu benchmark caiu {:.0}% em relacao ao registro anterior. Vale revisar inicializacao, energia e apps em segundo plano.",
                            drop_percent
                        ),
                        RecommendationSeverity::Warning,
                        RecommendationCategory::Benchmark,
                        15,
                        "historico local de benchmark",
                    ));
                }
            }
        }
    }

    if disk_free_percent < 20.0 {
        recommendations.push(rec(
            "disk-low-free-space",
            "Espaco livre em disco esta baixo",
            format!(
                "Seu disco esta com {:.0}% de uso. Mantenha pelo menos 20% livre para melhor desempenho.",
                disk_used_percent
            ),
            RecommendationSeverity::Warning,
            RecommendationCategory::Disk,
            20,
            "diagnostico de disco",
        ));
    }

    if ram_used_percent >= 80.0 {
        recommendations.push(rec(
            "memory-high-usage",
            "Uso de memoria elevado",
            format!(
                "A RAM esta em {:.0}% de uso. Fechar apps secundarios pode liberar recursos.",
                ram_used_percent
            ),
            RecommendationSeverity::Warning,
            RecommendationCategory::Memory,
            25,
            "diagnostico de memoria",
        ));
    }

    if diagnostic.cpu_usage_percent >= 85.0 {
        recommendations.push(rec(
            "cpu-high-usage",
            "Uso de CPU elevado",
            format!(
                "A CPU esta em {:.0}% de uso. Verifique processos em segundo plano antes de otimizar.",
                diagnostic.cpu_usage_percent
            ),
            RecommendationSeverity::Warning,
            RecommendationCategory::Cpu,
            25,
            "diagnostico de CPU",
        ));
    }

    if diagnostic.startup_items_count > 0 {
        let severity = if diagnostic.startup_high_impact_count >= 3 {
            RecommendationSeverity::Warning
        } else {
            RecommendationSeverity::Info
        };
        recommendations.push(rec(
            "startup-items",
            format!(
                "Voce possui {} programas iniciando com o Windows.",
                diagnostic.startup_items_count
            ),
            format!(
                "{} item(ns) possuem alto impacto estimado. Recomendacao: revisar inicializacao antes de otimizar.",
                diagnostic.startup_high_impact_count
            ),
            severity,
            RecommendationCategory::Startup,
            30,
            "diagnostico de inicializacao",
        ));
    }

    if temporary_files_gb >= 1.0 {
        recommendations.push(rec(
            "temporary-files-found",
            format!("Existem {:.1} GB de temporarios.", temporary_files_gb),
            "A Clean Engine pode liberar espaco com confirmacao antes de apagar qualquer arquivo.",
            RecommendationSeverity::Info,
            RecommendationCategory::Cleanup,
            35,
            "scan local de temporarios",
        ));
    }

    if power_plan_is_balanced {
        recommendations.push(rec(
            "power-plan-balanced",
            "Seu plano de energia esta em Equilibrado.",
            "Para jogos ou alto desempenho, o Perfil Gamer pode usar um plano mais agressivo com reversao.",
            RecommendationSeverity::Info,
            RecommendationCategory::Power,
            40,
            "powercfg somente leitura",
        ));
    } else if is_power_saver_plan(power_plan_name) {
        recommendations.push(rec(
            "power-plan-economy",
            "Seu plano de energia esta em Economia.",
            "Esse modo reduz consumo, mas pode limitar desempenho. O NEX pode sugerir um perfil adequado.",
            RecommendationSeverity::Info,
            RecommendationCategory::Power,
            40,
            "powercfg somente leitura",
        ));
    }

    if let Some(current_boot) = diagnostic.boot_time_seconds {
        if let Some(previous_boot) = previous_boot_seconds(previous_report) {
            if current_boot > previous_boot.saturating_add(15) {
                recommendations.push(rec(
                    "boot-time-increase",
                    "Tempo de boot aumentou",
                    format!(
                        "O boot atual esta {}s acima do registro anterior. Programas de inicializacao podem ser a causa.",
                        current_boot.saturating_sub(previous_boot)
                    ),
                    RecommendationSeverity::Info,
                    RecommendationCategory::Boot,
                    35,
                    "historico local de diagnostico",
                ));
            }
        }
    }

    if should_recommend_gamer_profile(diagnostic, temporary_files_gb, power_plan_is_balanced) {
        recommendations.push(rec(
            "profile-gamer-recommendation",
            "Recomendacao: Perfil Gamer.",
            "Indicado para liberar recursos, revisar inicializacao e priorizar desempenho sob demanda.",
            RecommendationSeverity::Info,
            RecommendationCategory::Profile,
            45,
            "advisor local",
        ));
    }

    if disk_free_percent >= 20.0 && disk_used_percent >= 45.0 {
        recommendations.push(rec(
            "disk-observe-usage",
            "Espaco em disco",
            format!(
                "Seu disco esta com {:.0}% de uso. Ainda esta saudavel, mas vale acompanhar a evolucao.",
                disk_used_percent
            ),
            RecommendationSeverity::Info,
            RecommendationCategory::Disk,
            60,
            "diagnostico de disco",
        ));
    }

    if diagnostic.health_score >= 90 && diagnostic.security_active && disk_free_percent >= 20.0 {
        recommendations.push(rec(
            "system-healthy",
            "Seu sistema esta saudavel",
            "Os principais indicadores estao dentro dos parametros normais.",
            RecommendationSeverity::Success,
            RecommendationCategory::SystemHealth,
            90,
            "diagnostico",
        ));
    }

    recommendations.sort_by_key(|item| item.priority);
    recommendations.truncate(4);

    AdvisorReport {
        generated_at: now_timestamp(),
        engine_version: "advisor-pro-local-rules-v2".to_string(),
        read_only: true,
        summary: AdvisorReportSummary {
            health_score: diagnostic.health_score,
            benchmark_score: input.benchmark.as_ref().map(|benchmark| benchmark.score),
            boot_time_seconds: diagnostic.boot_time_seconds,
        },
        recommendations,
    }
}

fn rec(
    id: impl Into<String>,
    title: impl Into<String>,
    description: impl Into<String>,
    severity: RecommendationSeverity,
    category: RecommendationCategory,
    priority: u8,
    source: impl Into<String>,
) -> AdvisorRecommendation {
    AdvisorRecommendation {
        id: id.into(),
        title: title.into(),
        description: description.into(),
        severity,
        category,
        priority,
        source: source.into(),
    }
}

fn safe_percent(value: f32, total: f32) -> f32 {
    if total <= 0.0 {
        0.0
    } else {
        ((value / total) * 100.0).clamp(0.0, 100.0)
    }
}

fn is_balanced_power_plan(plan_name: &str) -> bool {
    let normalized = plan_name.to_lowercase();
    normalized.contains("equilibr") || normalized.contains("balanced")
}

fn is_power_saver_plan(plan_name: &str) -> bool {
    let normalized = plan_name.to_lowercase();
    normalized.contains("econom") || normalized.contains("power saver")
}

fn should_recommend_gamer_profile(
    diagnostic: &DiagnosticSnapshot,
    temporary_files_gb: f32,
    power_plan_is_balanced: bool,
) -> bool {
    power_plan_is_balanced
        && (diagnostic.startup_items_count >= 8
            || diagnostic.startup_high_impact_count >= 1
            || temporary_files_gb >= 1.0
            || safe_percent(diagnostic.ram_used_gb, diagnostic.ram_total_gb) >= 55.0)
}

fn previous_benchmark_score(report: Option<&AdvisorReport>) -> Option<u32> {
    report.and_then(|report| report.summary.benchmark_score)
}

fn previous_boot_seconds(report: Option<&AdvisorReport>) -> Option<u32> {
    report.and_then(|report| report.summary.boot_time_seconds)
}

fn advisor_history_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Não foi possível localizar AppData: {err}"))?;
    dir.push("history");
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Não foi possível criar histórico local: {err}"))?;
    dir.push("advisor_reports.json");
    Ok(dir)
}

fn read_history(path: &PathBuf) -> AdvisorHistory {
    let Ok(contents) = fs::read_to_string(path) else {
        return AdvisorHistory::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_history(path: &PathBuf, history: &AdvisorHistory) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(history)
        .map_err(|err| format!("Não foi possível serializar histórico local: {err}"))?;
    fs::write(path, contents)
        .map_err(|err| format!("Não foi possível gravar histórico local: {err}"))
}

fn now_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    seconds.to_string()
}
