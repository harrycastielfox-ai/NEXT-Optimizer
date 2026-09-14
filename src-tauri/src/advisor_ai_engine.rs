use crate::{advanced, benchmark, clean, diagnostic, gamer, performance, profiles, startup};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const ENGINE_VERSION: &str = "advisor-ai-engine-local-readonly-v1";
const TOTAL_SCORE_WEIGHT: u16 = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorAiReport {
    pub generated_at: String,
    pub engine_version: String,
    pub read_only: bool,
    pub will_modify_system: bool,
    pub offline: bool,
    pub telemetry: bool,
    pub chatbot: bool,
    pub hermes_score: HermesScore,
    pub summary: AdvisorAiSummary,
    pub findings: Vec<AdvisorAiFinding>,
    pub recommendations: Vec<AdvisorAiRecommendation>,
    pub sources: Vec<AdvisorAiSource>,
    pub unavailable_data: Vec<String>,
    pub history: AdvisorAiHistorySummary,
    pub safeguards: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesScore {
    pub value: Option<u8>,
    pub label: String,
    pub status: ScoreStatus,
    pub confidence: AdvisorAiConfidence,
    pub coverage_percent: u8,
    pub explanation: String,
    pub components: Vec<HermesScoreComponent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesScoreComponent {
    pub id: String,
    pub label: String,
    pub weight: u8,
    pub value: Option<u8>,
    pub status: ScoreStatus,
    pub source_id: String,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScoreStatus {
    Available,
    Partial,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorAiSummary {
    pub general_state: String,
    pub problem_count: usize,
    pub recommendation_count: usize,
    pub recommended_profile: Option<String>,
    pub recommended_profile_reason: String,
    pub confidence: AdvisorAiConfidence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorAiFinding {
    pub id: String,
    pub title: String,
    pub explanation: String,
    pub severity: AdvisorAiSeverity,
    pub category: AdvisorAiCategory,
    pub impact_estimate: String,
    pub source_ids: Vec<String>,
    pub confidence: AdvisorAiConfidence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorAiRecommendation {
    pub id: String,
    pub title: String,
    pub description: String,
    pub severity: AdvisorAiSeverity,
    pub category: AdvisorAiCategory,
    pub suggested_profile: Option<String>,
    pub user_decision_required: bool,
    pub can_apply_automatically: bool,
    pub source_ids: Vec<String>,
    pub confidence: AdvisorAiConfidence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorAiSource {
    pub id: String,
    pub label: String,
    pub status: AdvisorAiSourceStatus,
    pub confidence: AdvisorAiConfidence,
    pub detail: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorAiHistorySummary {
    pub diagnostic_reports: usize,
    pub benchmark_reports: usize,
    pub advisor_reports: usize,
    pub optimize_plans: usize,
    pub snapshots: usize,
    pub logs: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvisorAiSourceStatus {
    Available,
    Partial,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum AdvisorAiConfidence {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AdvisorAiSeverity {
    Critical,
    High,
    Medium,
    Low,
    Informational,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdvisorAiCategory {
    System,
    Startup,
    Cleanup,
    Benchmark,
    Memory,
    Disk,
    Performance,
    Security,
    Gamer,
    Restore,
    Profile,
}

#[derive(Debug, Clone)]
struct AdvisorAiContext {
    diagnostic: SourceData<diagnostic::DiagnosticReport>,
    startup: SourceData<startup::StartupReport>,
    clean: SourceData<clean::CleanScanReport>,
    benchmark: SourceData<benchmark::BenchmarkReport>,
    performance: SourceData<performance::PerformanceReport>,
    profiles: SourceData<profiles::ProfilesCatalog>,
    gamer: SourceData<gamer::GamerReport>,
    advanced: SourceData<advanced::AdvancedCatalog>,
    history: AdvisorAiHistorySummary,
}

#[derive(Debug, Clone)]
struct SourceData<T> {
    data: Option<T>,
    source: AdvisorAiSource,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BenchmarkHistoryRead {
    reports: Vec<benchmark::BenchmarkReport>,
}

#[derive(Debug, Deserialize, Default)]
struct CountHistory {
    #[serde(default)]
    reports: Vec<serde_json::Value>,
    #[serde(default)]
    plans: Vec<serde_json::Value>,
    #[serde(default)]
    snapshots: Vec<serde_json::Value>,
    #[serde(default)]
    events: Vec<serde_json::Value>,
}

#[tauri::command]
pub async fn advisor_ai_engine_analyze(app: AppHandle) -> Result<AdvisorAiReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let context = collect_context(&app);
        build_report(context)
    })
    .await
    .map_err(|err| format!("Falha ao analisar NEX Insight em segundo plano: {err}"))
}

fn collect_context(app: &AppHandle) -> AdvisorAiContext {
    let diagnostic_report = diagnostic::latest_cached_report(app)
        .ok()
        .flatten()
        .unwrap_or_else(diagnostic::collect_diagnostic_report);
    let startup_report = startup::collect_startup_report();
    let clean_report = clean::collect_clean_scan();
    let performance_report = performance::collect_performance_report();
    let gamer_report = gamer::collect_gamer_report();
    let profiles_catalog = profiles::profiles_list();
    let advanced_catalog = advanced::collect_advanced_catalog();
    let benchmark_report = read_latest_benchmark(app);
    let history = read_history_summary(app);

    AdvisorAiContext {
        diagnostic: from_report(
            "diagnostic",
            "Diagnostic Engine",
            "Leitura real de CPU, RAM, disco, GPU, seguranca, update, uptime e estado geral.",
            diagnostic_report,
            |report| report.warnings.as_slice(),
        ),
        startup: from_report(
            "startup",
            "Startup Engine",
            "Leitura real dos programas configurados para iniciar com o Windows.",
            startup_report,
            |report| report.warnings.as_slice(),
        ),
        clean: from_report(
            "clean",
            "Clean Engine Scan",
            "Scan seguro e somente leitura de arquivos temporarios, cache e logs permitidos.",
            clean_report,
            |report| report.warnings.as_slice(),
        ),
        benchmark: benchmark_report,
        performance: from_report(
            "performance",
            "Performance Engine",
            "Leitura real de plano de energia, Game Mode, efeitos visuais e ajustes de desempenho.",
            performance_report,
            |report| report.warnings.as_slice(),
        ),
        profiles: SourceData {
            data: Some(profiles_catalog),
            source: source(
                "profiles",
                "Perfis NEX",
                AdvisorAiSourceStatus::Available,
                AdvisorAiConfidence::High,
                "Catalogo local de perfis oficiais. Nenhum perfil e aplicado pela NEX Insight.",
                Vec::new(),
            ),
        },
        gamer: from_report(
            "gamer",
            "Gamer Engine",
            "Leitura real de processos em execucao, jogos detectados e apps sugeridos para fechar.",
            gamer_report,
            |report| report.warnings.as_slice(),
        ),
        advanced: from_report(
            "advanced",
            "CMD / Registro / PowerShell",
            "Catalogo local de comandos avancados allowlistados e bloqueados.",
            advanced_catalog,
            |catalog| catalog.warnings.as_slice(),
        ),
        history,
    }
}

fn from_report<T, F>(
    id: &str,
    label: &str,
    available_detail: &str,
    report: T,
    warnings_for: F,
) -> SourceData<T>
where
    F: Fn(&T) -> &[String],
{
    let warnings = warnings_for(&report).to_vec();
    if has_fallback_warning(&warnings) {
        SourceData {
            data: None,
            source: source(
                id,
                label,
                AdvisorAiSourceStatus::Unavailable,
                AdvisorAiConfidence::Low,
                "Indisponivel: a engine retornou fallback demonstrativo, entao a NEX Insight ignorou esses valores para nao inventar dados.",
                warnings,
            ),
        }
    } else if warnings.is_empty() {
        SourceData {
            data: Some(report),
            source: source(
                id,
                label,
                AdvisorAiSourceStatus::Available,
                AdvisorAiConfidence::High,
                available_detail,
                warnings,
            ),
        }
    } else {
        SourceData {
            data: Some(report),
            source: source(
                id,
                label,
                AdvisorAiSourceStatus::Partial,
                AdvisorAiConfidence::Medium,
                available_detail,
                warnings,
            ),
        }
    }
}

fn build_report(context: AdvisorAiContext) -> AdvisorAiReport {
    let mut findings = build_findings(&context);
    let hermes_score = build_score(&context);
    let recommendations = build_recommendations(&context, &findings);
    let recommended_profile = choose_profile(&context, &findings);

    if findings.is_empty() {
        findings.push(finding(
            "system-no-major-risk",
            "Nenhum gargalo critico detectado",
            "As fontes reais disponiveis nao indicaram problema critico neste momento.",
            AdvisorAiSeverity::Informational,
            AdvisorAiCategory::System,
            "Sem impacto negativo relevante detectado pelas fontes disponiveis.",
            vec!["diagnostic", "performance"],
            overall_confidence(&context, hermes_score.coverage_percent),
        ));
    }

    let problem_count = findings
        .iter()
        .filter(|finding| finding.severity != AdvisorAiSeverity::Informational)
        .count();
    let confidence = overall_confidence(&context, hermes_score.coverage_percent);
    let sources = sources_from_context(&context);
    let unavailable_data = sources
        .iter()
        .filter(|source| source.status == AdvisorAiSourceStatus::Unavailable)
        .map(|source| format!("{}: {}", source.label, source.detail))
        .collect::<Vec<_>>();

    AdvisorAiReport {
        generated_at: now_timestamp(),
        engine_version: ENGINE_VERSION.to_string(),
        read_only: true,
        will_modify_system: false,
        offline: true,
        telemetry: false,
        chatbot: false,
        summary: AdvisorAiSummary {
            general_state: general_state_label(&hermes_score, problem_count).to_string(),
            problem_count,
            recommendation_count: recommendations.len(),
            recommended_profile: recommended_profile
                .as_ref()
                .map(|profile| profile.0.clone()),
            recommended_profile_reason: recommended_profile
                .map(|profile| profile.1)
                .unwrap_or_else(|| {
                    "Perfil nao recomendado: fontes suficientes nao indicaram uma direcao segura."
                        .to_string()
                }),
            confidence,
        },
        hermes_score,
        findings,
        recommendations,
        sources,
        unavailable_data,
        history: context.history,
        safeguards: vec![
            "Somente leitura: nenhuma acao do Windows e executada por esta engine.".to_string(),
            "Tudo local/offline: nenhum dado e enviado para nuvem.".to_string(),
            "Sem chatbot e sem dependencia obrigatoria de modelos externos.".to_string(),
            "Valores de fallback demonstrativo sao marcados como indisponiveis.".to_string(),
            "A NEX Insight recomenda; o usuario decide e qualquer aplicacao continua exigindo confirmacao.".to_string(),
        ],
    }
}

fn build_findings(context: &AdvisorAiContext) -> Vec<AdvisorAiFinding> {
    let mut findings = Vec::new();

    if let Some(report) = &context.diagnostic.data {
        let disk_free_percent = percent(report.disk.free_gb, report.disk.total_gb);
        if disk_free_percent > 0.0 && disk_free_percent < 10.0 {
            findings.push(finding(
                "disk-critical-free-space",
                "Espaco livre critico no disco principal",
                format!(
                    "O disco {} possui apenas {:.0}% livre ({:.1} GB de {:.1} GB).",
                    report.disk.mount, disk_free_percent, report.disk.free_gb, report.disk.total_gb
                ),
                AdvisorAiSeverity::Critical,
                AdvisorAiCategory::Disk,
                "Pode causar lentidao, falhas de atualizacao e baixa margem para cache do sistema.",
                vec!["diagnostic"],
                confidence_from_source(&context.diagnostic.source),
            ));
        } else if disk_free_percent > 0.0 && disk_free_percent < 20.0 {
            findings.push(finding(
                "disk-low-free-space",
                "Pouco espaco livre no disco principal",
                format!(
                    "O disco {} possui {:.0}% livre ({:.1} GB disponiveis).",
                    report.disk.mount, disk_free_percent, report.disk.free_gb
                ),
                AdvisorAiSeverity::High,
                AdvisorAiCategory::Disk,
                "Pode reduzir desempenho e limitar atualizacoes do Windows.",
                vec!["diagnostic"],
                confidence_from_source(&context.diagnostic.source),
            ));
        }

        if report.ram.used_percent >= 85.0 {
            findings.push(finding(
                "memory-high-usage",
                "Uso de memoria elevado",
                format!(
                    "A RAM esta em {:.0}% de uso ({:.1} GB usados de {:.1} GB).",
                    report.ram.used_percent, report.ram.used_gb, report.ram.total_gb
                ),
                AdvisorAiSeverity::High,
                AdvisorAiCategory::Memory,
                "Pode causar troca para disco e queda perceptivel de resposta.",
                vec!["diagnostic"],
                confidence_from_source(&context.diagnostic.source),
            ));
        } else if report.ram.used_percent >= 75.0 {
            findings.push(finding(
                "memory-medium-usage",
                "Uso de memoria acima do ideal",
                format!("A RAM esta em {:.0}% de uso.", report.ram.used_percent),
                AdvisorAiSeverity::Medium,
                AdvisorAiCategory::Memory,
                "Pode impactar multitarefa e jogos pesados.",
                vec!["diagnostic"],
                confidence_from_source(&context.diagnostic.source),
            ));
        }

        if report.cpu.usage_percent >= 85.0 {
            findings.push(finding(
                "cpu-high-usage",
                "CPU com uso elevado",
                format!(
                    "A CPU esta em {:.0}% durante a leitura.",
                    report.cpu.usage_percent
                ),
                AdvisorAiSeverity::High,
                AdvisorAiCategory::Performance,
                "Pode indicar processos em segundo plano consumindo resposta do sistema.",
                vec!["diagnostic"],
                confidence_from_source(&context.diagnostic.source),
            ));
        }

        if report.defender.available && !report.defender.active {
            findings.push(finding(
                "security-defender-inactive",
                "Protecao do Windows inativa",
                "O Defender ou a protecao em tempo real parecem desativados.".to_string(),
                AdvisorAiSeverity::Critical,
                AdvisorAiCategory::Security,
                "Risco de seguranca. Otimizacoes devem ser secundarias ate a protecao estar ativa.",
                vec!["diagnostic"],
                confidence_from_source(&context.diagnostic.source),
            ));
        }
    }

    if let Some(report) = &context.startup.data {
        if report.total_items >= 20 || report.high_impact_count >= 5 {
            findings.push(finding(
                "startup-high-impact",
                "Inicializacao pesada",
                format!(
                    "{} itens iniciam com o Windows, sendo {} de alto impacto.",
                    report.total_items, report.high_impact_count
                ),
                AdvisorAiSeverity::High,
                AdvisorAiCategory::Startup,
                "Pode aumentar o tempo de boot e consumir RAM logo apos iniciar o PC.",
                vec!["startup"],
                confidence_from_source(&context.startup.source),
            ));
        } else if report.total_items >= 10 || report.high_impact_count >= 2 {
            findings.push(finding(
                "startup-medium-impact",
                "Inicializacao pode ser otimizada",
                format!(
                    "{} itens iniciam com o Windows, com {} de alto impacto.",
                    report.total_items, report.high_impact_count
                ),
                AdvisorAiSeverity::Medium,
                AdvisorAiCategory::Startup,
                "Pode haver ganho ao revisar apps que nao precisam iniciar automaticamente.",
                vec!["startup"],
                confidence_from_source(&context.startup.source),
            ));
        }
    }

    if let Some(report) = &context.clean.data {
        if report.total_gb >= 6.0 {
            findings.push(finding(
                "cleanup-high",
                "Muitos arquivos temporarios detectados",
                format!(
                    "{:.1} GB podem ser revisados pela Clean Engine.",
                    report.total_gb
                ),
                AdvisorAiSeverity::High,
                AdvisorAiCategory::Cleanup,
                "Pode recuperar espaco e reduzir lixo acumulado sem tocar nas pastas protegidas.",
                vec!["clean"],
                confidence_from_source(&context.clean.source),
            ));
        } else if report.total_gb >= 2.0 {
            findings.push(finding(
                "cleanup-medium",
                "Arquivos temporarios acumulados",
                format!(
                    "{:.1} GB foram encontrados no scan seguro.",
                    report.total_gb
                ),
                AdvisorAiSeverity::Medium,
                AdvisorAiCategory::Cleanup,
                "Boa oportunidade de limpeza com confirmacao do usuario.",
                vec!["clean"],
                confidence_from_source(&context.clean.source),
            ));
        }
    }

    if let Some(report) = &context.benchmark.data {
        if let Some(delta) = report.delta {
            if delta <= -8 {
                findings.push(finding(
                    "benchmark-drop-high",
                    "Benchmark caiu",
                    format!(
                        "O score atual e {} e caiu {} ponto(s) em relacao ao historico.",
                        report.score,
                        delta.abs()
                    ),
                    AdvisorAiSeverity::High,
                    AdvisorAiCategory::Benchmark,
                    "Indica regressao mensuravel no estado geral do PC.",
                    vec!["benchmark"],
                    confidence_from_source(&context.benchmark.source),
                ));
            } else if delta <= -4 {
                findings.push(finding(
                    "benchmark-drop-medium",
                    "Benchmark abaixo do historico",
                    format!("Queda de {} ponto(s) no benchmark local.", delta.abs()),
                    AdvisorAiSeverity::Medium,
                    AdvisorAiCategory::Benchmark,
                    "Vale comparar com startup, RAM e espaco em disco.",
                    vec!["benchmark"],
                    confidence_from_source(&context.benchmark.source),
                ));
            }
        }
    }

    if let Some(report) = &context.performance.data {
        let game_running = context
            .gamer
            .data
            .as_ref()
            .map(|gamer| gamer.summary.detected_games > 0)
            .unwrap_or(false);
        let balanced = is_balanced(&report.power_plan.active_scheme_name);
        if game_running && balanced {
            findings.push(finding(
                "performance-balanced-while-gaming",
                "Plano equilibrado durante jogo",
                "Um jogo foi detectado enquanto o plano de energia esta equilibrado.".to_string(),
                AdvisorAiSeverity::Medium,
                AdvisorAiCategory::Gamer,
                "Pode limitar desempenho em jogos. Perfil Gamer pode ser mais adequado.",
                vec!["performance", "gamer"],
                mixed_confidence(&[&context.performance.source, &context.gamer.source]),
            ));
        }

        if game_running && report.game_mode.enabled == Some(false) {
            findings.push(finding(
                "game-mode-disabled-while-gaming",
                "Game Mode desativado durante jogo",
                "O Game Mode parece desativado enquanto ha jogo em execucao.".to_string(),
                AdvisorAiSeverity::High,
                AdvisorAiCategory::Gamer,
                "Pode reduzir priorizacao de recursos para jogos.",
                vec!["performance", "gamer"],
                mixed_confidence(&[&context.performance.source, &context.gamer.source]),
            ));
        }

        if report.visual_effects.transparency_enabled == Some(true)
            || report.visual_effects.animations_enabled == Some(true)
            || report.visual_effects.shadows_enabled == Some(true)
        {
            findings.push(finding(
                "visual-effects-enabled",
                "Efeitos visuais ativos",
                "Transparencias, animacoes ou sombras estao ativas.".to_string(),
                AdvisorAiSeverity::Low,
                AdvisorAiCategory::Performance,
                "Impacto geralmente baixo, mas pode ajudar em PCs modestos ou perfis focados em jogo.",
                vec!["performance"],
                confidence_from_source(&context.performance.source),
            ));
        }
    }

    if let Some(report) = &context.gamer.data {
        if report.summary.suggested_to_close >= 4 || report.summary.estimated_ram_to_free_mb >= 2048
        {
            findings.push(finding(
                "gamer-background-heavy",
                "Processos secundarios podem atrapalhar jogos",
                format!(
                    "{} processo(s) sugeridos para fechar, com ate {} MB de RAM potencialmente liberavel.",
                    report.summary.suggested_to_close, report.summary.estimated_ram_to_free_mb
                ),
                AdvisorAiSeverity::Medium,
                AdvisorAiCategory::Gamer,
                "Pode melhorar foco de recursos durante jogo, sempre com confirmacao.",
                vec!["gamer"],
                confidence_from_source(&context.gamer.source),
            ));
        }
    }

    if context.history.snapshots == 0 {
        findings.push(finding(
            "restore-no-snapshots",
            "Nenhum snapshot local encontrado",
            "O historico local nao possui snapshots registrados ainda.".to_string(),
            AdvisorAiSeverity::Informational,
            AdvisorAiCategory::Restore,
            "Antes de otimizacoes reais, snapshots continuam obrigatorios nas engines de aplicacao.",
            vec!["restore"],
            AdvisorAiConfidence::Medium,
        ));
    }

    findings
}

fn build_recommendations(
    context: &AdvisorAiContext,
    findings: &[AdvisorAiFinding],
) -> Vec<AdvisorAiRecommendation> {
    let mut recommendations = Vec::new();

    if has_category(findings, AdvisorAiCategory::Startup) {
        recommendations.push(recommendation(
            "review-startup",
            "Revisar inicializacao",
            "Usar a Startup Engine para revisar apps de alto impacto. A NEX Insight nao remove nem desativa nada automaticamente.",
            highest_severity_for(findings, AdvisorAiCategory::Startup),
            AdvisorAiCategory::Startup,
            None,
            vec!["startup"],
            confidence_from_source(&context.startup.source),
        ));
    }

    if has_category(findings, AdvisorAiCategory::Cleanup) {
        recommendations.push(recommendation(
            "run-clean-scan-flow",
            "Executar fluxo de limpeza segura",
            "Abrir o fluxo da Clean Engine: escanear, mostrar itens, confirmar e somente depois limpar.",
            highest_severity_for(findings, AdvisorAiCategory::Cleanup),
            AdvisorAiCategory::Cleanup,
            None,
            vec!["clean"],
            confidence_from_source(&context.clean.source),
        ));
    }

    if has_category(findings, AdvisorAiCategory::Gamer) {
        recommendations.push(recommendation(
            "suggest-gamer-profile",
            "Considerar Perfil Gamer",
            "Perfil Gamer pode priorizar desempenho durante jogos, mas a aplicacao exige decisao e confirmacao do usuario.",
            highest_severity_for(findings, AdvisorAiCategory::Gamer),
            AdvisorAiCategory::Profile,
            Some("Gamer"),
            vec!["performance", "gamer", "profiles"],
            mixed_confidence(&[
                &context.performance.source,
                &context.gamer.source,
                &context.profiles.source,
            ]),
        ));
    }

    if has_category(findings, AdvisorAiCategory::Performance)
        && !has_category(findings, AdvisorAiCategory::Gamer)
    {
        recommendations.push(recommendation(
            "suggest-work-profile",
            "Considerar Perfil Trabalho",
            "Perfil Trabalho reduz custo visual leve mantendo estabilidade e produtividade.",
            highest_severity_for(findings, AdvisorAiCategory::Performance),
            AdvisorAiCategory::Profile,
            Some("Trabalho"),
            vec!["performance", "profiles"],
            mixed_confidence(&[&context.performance.source, &context.profiles.source]),
        ));
    }

    if has_category(findings, AdvisorAiCategory::Security) {
        recommendations.push(recommendation(
            "security-first",
            "Priorizar seguranca antes de otimizar",
            "Corrigir protecao do Windows antes de aplicar perfis ou ajustes de desempenho.",
            AdvisorAiSeverity::Critical,
            AdvisorAiCategory::Security,
            Some("Seguro"),
            vec!["diagnostic", "profiles"],
            mixed_confidence(&[&context.diagnostic.source, &context.profiles.source]),
        ));
    }

    if has_category(findings, AdvisorAiCategory::Disk) {
        recommendations.push(recommendation(
            "free-disk-space",
            "Liberar espaco com cuidado",
            "Priorizar limpeza segura e manter Downloads, Documentos, Desktop e midias protegidos.",
            highest_severity_for(findings, AdvisorAiCategory::Disk),
            AdvisorAiCategory::Disk,
            None,
            vec!["diagnostic", "clean"],
            mixed_confidence(&[&context.diagnostic.source, &context.clean.source]),
        ));
    }

    if recommendations.is_empty() {
        recommendations.push(recommendation(
            "keep-safe-profile",
            "Manter estado atual",
            "Nenhuma acao e recomendada automaticamente. Continue usando analises sob demanda.",
            AdvisorAiSeverity::Informational,
            AdvisorAiCategory::System,
            Some("Seguro"),
            vec!["diagnostic", "profiles"],
            mixed_confidence(&[&context.diagnostic.source, &context.profiles.source]),
        ));
    }

    recommendations
}

fn build_score(context: &AdvisorAiContext) -> HermesScore {
    let components = vec![
        benchmark_component(context),
        startup_component(context),
        cleanup_component(context),
        performance_component(context),
        memory_component(context),
        disk_component(context),
        security_component(context),
    ];

    let available_weight = components
        .iter()
        .filter(|component| component.value.is_some())
        .map(|component| component.weight as u16)
        .sum::<u16>();
    let coverage_percent = ((available_weight as f32 / TOTAL_SCORE_WEIGHT as f32) * 100.0)
        .round()
        .clamp(0.0, 100.0) as u8;

    if available_weight < 40 {
        return HermesScore {
            value: None,
            label: "Indisponivel".to_string(),
            status: ScoreStatus::Unavailable,
            confidence: AdvisorAiConfidence::Low,
            coverage_percent,
            explanation:
                "Fontes reais insuficientes para calcular um Score NEX sem inventar dados."
                    .to_string(),
            components,
        };
    }

    let weighted_sum = components
        .iter()
        .filter_map(|component| {
            component
                .value
                .map(|value| value as u16 * component.weight as u16)
        })
        .sum::<u16>();
    let value = (weighted_sum as f32 / available_weight as f32)
        .round()
        .clamp(0.0, 100.0) as u8;
    let confidence = if coverage_percent >= 80 {
        AdvisorAiConfidence::High
    } else if coverage_percent >= 55 {
        AdvisorAiConfidence::Medium
    } else {
        AdvisorAiConfidence::Low
    };

    HermesScore {
        value: Some(value),
        label: score_label(value).to_string(),
        status: if coverage_percent == 100 {
            ScoreStatus::Available
        } else {
            ScoreStatus::Partial
        },
        confidence,
        coverage_percent,
        explanation: if coverage_percent == 100 {
            "Score calculado com todas as fontes planejadas disponiveis.".to_string()
        } else {
            format!(
                "Score calculado apenas com fontes reais disponiveis ({}% de cobertura).",
                coverage_percent
            )
        },
        components,
    }
}

fn benchmark_component(context: &AdvisorAiContext) -> HermesScoreComponent {
    match &context.benchmark.data {
        Some(report) => component(
            "benchmark",
            "Benchmark",
            20,
            Some(report.score),
            ScoreStatus::Available,
            "benchmark",
            format!("Ultimo score registrado: {}.", report.score),
        ),
        None => unavailable_component(
            "benchmark",
            "Benchmark",
            20,
            "benchmark",
            "Historico de benchmark indisponivel.",
        ),
    }
}

fn startup_component(context: &AdvisorAiContext) -> HermesScoreComponent {
    match &context.startup.data {
        Some(report) => {
            let score = (100.0
                - report.total_items as f32 * 1.7
                - report.high_impact_count as f32 * 4.0
                - report.medium_impact_count as f32 * 1.5)
                .clamp(30.0, 100.0)
                .round() as u8;
            component(
                "startup",
                "Inicializacao",
                18,
                Some(score),
                ScoreStatus::Available,
                "startup",
                format!(
                    "{} item(ns), {} alto impacto.",
                    report.total_items, report.high_impact_count
                ),
            )
        }
        None => unavailable_component(
            "startup",
            "Inicializacao",
            18,
            "startup",
            "Startup Engine indisponivel.",
        ),
    }
}

fn cleanup_component(context: &AdvisorAiContext) -> HermesScoreComponent {
    match &context.clean.data {
        Some(report) => {
            let score = (100.0 - report.total_gb * 7.5).clamp(35.0, 100.0).round() as u8;
            component(
                "cleanup",
                "Limpeza",
                16,
                Some(score),
                ScoreStatus::Available,
                "clean",
                format!("{:.1} GB detectados no scan seguro.", report.total_gb),
            )
        }
        None => unavailable_component(
            "cleanup",
            "Limpeza",
            16,
            "clean",
            "Clean Engine indisponivel.",
        ),
    }
}

fn performance_component(context: &AdvisorAiContext) -> HermesScoreComponent {
    match &context.performance.data {
        Some(report) => {
            let mut score: f32 = if report.power_plan.status == "Desempenho" {
                95.0
            } else if report.power_plan.status == "Equilibrado" {
                86.0
            } else {
                78.0
            };
            if report.game_mode.enabled == Some(false) {
                score -= 8.0;
            }
            if report.visual_effects.transparency_enabled == Some(true) {
                score -= 3.0;
            }
            if report.visual_effects.animations_enabled == Some(true) {
                score -= 4.0;
            }
            if report.visual_effects.shadows_enabled == Some(true) {
                score -= 3.0;
            }
            if report.background_apps.enabled == Some(true) {
                score -= 4.0;
            }
            component(
                "performance",
                "Performance",
                16,
                Some(score.clamp(35.0, 100.0).round() as u8),
                ScoreStatus::Available,
                "performance",
                format!(
                    "Plano {}, Game Mode {}.",
                    report.power_plan.active_scheme_name, report.game_mode.status
                ),
            )
        }
        None => unavailable_component(
            "performance",
            "Performance",
            16,
            "performance",
            "Performance Engine indisponivel.",
        ),
    }
}

fn memory_component(context: &AdvisorAiContext) -> HermesScoreComponent {
    match &context.diagnostic.data {
        Some(report) => {
            let score = (100.0 - report.ram.used_percent * 0.65)
                .clamp(30.0, 100.0)
                .round() as u8;
            component(
                "memory",
                "Memoria",
                12,
                Some(score),
                ScoreStatus::Available,
                "diagnostic",
                format!("{:.0}% de RAM em uso.", report.ram.used_percent),
            )
        }
        None => unavailable_component(
            "memory",
            "Memoria",
            12,
            "diagnostic",
            "Diagnostico indisponivel.",
        ),
    }
}

fn disk_component(context: &AdvisorAiContext) -> HermesScoreComponent {
    match &context.diagnostic.data {
        Some(report) => {
            let free_percent = percent(report.disk.free_gb, report.disk.total_gb);
            let score = if free_percent < 10.0 {
                35
            } else if free_percent < 20.0 {
                60
            } else {
                (70.0 + free_percent * 0.45).clamp(70.0, 100.0).round() as u8
            };
            component(
                "disk",
                "Disco",
                12,
                Some(score),
                ScoreStatus::Available,
                "diagnostic",
                format!("{:.0}% livre no disco principal.", free_percent),
            )
        }
        None => unavailable_component(
            "disk",
            "Disco",
            12,
            "diagnostic",
            "Diagnostico indisponivel.",
        ),
    }
}

fn security_component(context: &AdvisorAiContext) -> HermesScoreComponent {
    match &context.diagnostic.data {
        Some(report) => {
            let mut score: f32 = if report.defender.active { 100.0 } else { 35.0 };
            if !report
                .windows_update
                .service_status
                .eq_ignore_ascii_case("running")
            {
                score -= 10.0;
            }
            component(
                "security",
                "Seguranca",
                6,
                Some(score.clamp(20.0, 100.0).round() as u8),
                ScoreStatus::Available,
                "diagnostic",
                format!("Defender {}.", report.defender.status),
            )
        }
        None => unavailable_component(
            "security",
            "Seguranca",
            6,
            "diagnostic",
            "Diagnostico indisponivel.",
        ),
    }
}

fn read_latest_benchmark(app: &AppHandle) -> SourceData<benchmark::BenchmarkReport> {
    match read_history_file::<BenchmarkHistoryRead>(app, "benchmark_reports.json") {
        Ok(history) => match history.reports.into_iter().next() {
            Some(report) => SourceData {
                data: Some(report),
                source: source(
                    "benchmark",
                    "Benchmark Engine",
                    AdvisorAiSourceStatus::Available,
                    AdvisorAiConfidence::High,
                    "Ultimo benchmark local encontrado no historico. A NEX Insight nao executou novo benchmark.",
                    Vec::new(),
                ),
            },
            None => unavailable_source_data(
                "benchmark",
                "Benchmark Engine",
                "Indisponivel: historico de benchmark local vazio.",
            ),
        },
        Err(error) => unavailable_source_data(
            "benchmark",
            "Benchmark Engine",
            format!("Indisponivel: {error}"),
        ),
    }
}

fn read_history_summary(app: &AppHandle) -> AdvisorAiHistorySummary {
    AdvisorAiHistorySummary {
        diagnostic_reports: count_field(app, "diagnostic_reports.json", "reports"),
        benchmark_reports: count_field(app, "benchmark_reports.json", "reports"),
        advisor_reports: count_field(app, "advisor_reports.json", "reports"),
        optimize_plans: count_field(app, "optimize_now_plans.json", "plans"),
        snapshots: count_field(app, "restore_snapshots.json", "snapshots"),
        logs: [
            "restore_events.json",
            "performance_events.json",
            "profile_events.json",
            "gamer_events.json",
            "advanced_events.json",
        ]
        .iter()
        .map(|file| count_field(app, file, "events"))
        .sum(),
    }
}

fn read_history_file<T: DeserializeOwned>(app: &AppHandle, file_name: &str) -> Result<T, String> {
    let path = history_path(app, file_name)?;
    let contents = fs::read_to_string(&path)
        .map_err(|_| format!("arquivo local {} nao encontrado", file_name))?;
    serde_json::from_str::<T>(&contents)
        .map_err(|err| format!("nao foi possivel interpretar {}: {err}", file_name))
}

fn count_field(app: &AppHandle, file_name: &str, field: &str) -> usize {
    read_history_file::<CountHistory>(app, file_name)
        .map(|history| match field {
            "reports" => history.reports.len(),
            "plans" => history.plans.len(),
            "snapshots" => history.snapshots.len(),
            "events" => history.events.len(),
            _ => 0,
        })
        .unwrap_or_default()
}

fn history_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Nao foi possivel localizar AppData: {err}"))?;
    path.push("history");
    path.push(file_name);
    Ok(path)
}

fn source(
    id: &str,
    label: &str,
    status: AdvisorAiSourceStatus,
    confidence: AdvisorAiConfidence,
    detail: impl Into<String>,
    warnings: Vec<String>,
) -> AdvisorAiSource {
    AdvisorAiSource {
        id: id.to_string(),
        label: label.to_string(),
        status,
        confidence,
        detail: detail.into(),
        warnings,
    }
}

fn unavailable_source_data<T>(id: &str, label: &str, detail: impl Into<String>) -> SourceData<T> {
    SourceData {
        data: None,
        source: source(
            id,
            label,
            AdvisorAiSourceStatus::Unavailable,
            AdvisorAiConfidence::Low,
            detail,
            Vec::new(),
        ),
    }
}

fn component(
    id: &str,
    label: &str,
    weight: u8,
    value: Option<u8>,
    status: ScoreStatus,
    source_id: &str,
    explanation: impl Into<String>,
) -> HermesScoreComponent {
    HermesScoreComponent {
        id: id.to_string(),
        label: label.to_string(),
        weight,
        value,
        status,
        source_id: source_id.to_string(),
        explanation: explanation.into(),
    }
}

fn unavailable_component(
    id: &str,
    label: &str,
    weight: u8,
    source_id: &str,
    explanation: &str,
) -> HermesScoreComponent {
    component(
        id,
        label,
        weight,
        None,
        ScoreStatus::Unavailable,
        source_id,
        explanation,
    )
}

fn finding(
    id: &str,
    title: &str,
    explanation: impl Into<String>,
    severity: AdvisorAiSeverity,
    category: AdvisorAiCategory,
    impact_estimate: &str,
    source_ids: Vec<&str>,
    confidence: AdvisorAiConfidence,
) -> AdvisorAiFinding {
    AdvisorAiFinding {
        id: id.to_string(),
        title: title.to_string(),
        explanation: explanation.into(),
        severity,
        category,
        impact_estimate: impact_estimate.to_string(),
        source_ids: source_ids.into_iter().map(ToString::to_string).collect(),
        confidence,
    }
}

fn recommendation(
    id: &str,
    title: &str,
    description: &str,
    severity: AdvisorAiSeverity,
    category: AdvisorAiCategory,
    suggested_profile: Option<&str>,
    source_ids: Vec<&str>,
    confidence: AdvisorAiConfidence,
) -> AdvisorAiRecommendation {
    AdvisorAiRecommendation {
        id: id.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        severity,
        category,
        suggested_profile: suggested_profile.map(ToString::to_string),
        user_decision_required: true,
        can_apply_automatically: false,
        source_ids: source_ids.into_iter().map(ToString::to_string).collect(),
        confidence,
    }
}

fn has_fallback_warning(warnings: &[String]) -> bool {
    warnings.iter().any(|warning| {
        let lower = warning.to_lowercase();
        lower.contains("fallback") || lower.contains("demo")
    })
}

fn sources_from_context(context: &AdvisorAiContext) -> Vec<AdvisorAiSource> {
    vec![
        context.diagnostic.source.clone(),
        context.startup.source.clone(),
        context.clean.source.clone(),
        context.benchmark.source.clone(),
        context.performance.source.clone(),
        context.profiles.source.clone(),
        context.gamer.source.clone(),
        context.advanced.source.clone(),
        source(
            "history",
            "Historico local",
            AdvisorAiSourceStatus::Available,
            AdvisorAiConfidence::Medium,
            format!(
                "{} diagnostico(s), {} benchmark(s), {} snapshot(s), {} log(s).",
                context.history.diagnostic_reports,
                context.history.benchmark_reports,
                context.history.snapshots,
                context.history.logs
            ),
            Vec::new(),
        ),
    ]
}

fn confidence_from_source(source: &AdvisorAiSource) -> AdvisorAiConfidence {
    source.confidence.clone()
}

fn mixed_confidence(sources: &[&AdvisorAiSource]) -> AdvisorAiConfidence {
    if sources
        .iter()
        .any(|source| source.status == AdvisorAiSourceStatus::Unavailable)
    {
        AdvisorAiConfidence::Low
    } else if sources
        .iter()
        .any(|source| source.status == AdvisorAiSourceStatus::Partial)
    {
        AdvisorAiConfidence::Medium
    } else {
        AdvisorAiConfidence::High
    }
}

fn overall_confidence(context: &AdvisorAiContext, coverage_percent: u8) -> AdvisorAiConfidence {
    let unavailable_count = sources_from_context(context)
        .into_iter()
        .filter(|source| source.status == AdvisorAiSourceStatus::Unavailable)
        .count();
    if coverage_percent >= 80 && unavailable_count <= 1 {
        AdvisorAiConfidence::High
    } else if coverage_percent >= 55 && unavailable_count <= 3 {
        AdvisorAiConfidence::Medium
    } else {
        AdvisorAiConfidence::Low
    }
}

fn choose_profile(
    context: &AdvisorAiContext,
    findings: &[AdvisorAiFinding],
) -> Option<(String, String)> {
    let game_detected = context
        .gamer
        .data
        .as_ref()
        .map(|report| report.summary.detected_games > 0 || report.summary.suggested_to_close > 0)
        .unwrap_or(false);

    if game_detected || has_category(findings, AdvisorAiCategory::Gamer) {
        return Some((
            "Gamer".to_string(),
            "Jogo/processos de jogo foram detectados ou ha ajustes de desempenho relevantes para jogos."
                .to_string(),
        ));
    }

    if has_category(findings, AdvisorAiCategory::Security) {
        return Some((
            "Seguro".to_string(),
            "Ha sinal de atencao em seguranca; estabilidade deve vir antes de desempenho."
                .to_string(),
        ));
    }

    if has_category(findings, AdvisorAiCategory::Performance)
        || has_category(findings, AdvisorAiCategory::Memory)
        || has_category(findings, AdvisorAiCategory::Startup)
    {
        return Some((
            "Trabalho".to_string(),
            "Ha oportunidades de desempenho moderadas sem exigir perfil agressivo.".to_string(),
        ));
    }

    if context.profiles.data.is_some() {
        return Some((
            "Seguro".to_string(),
            "Nenhuma pressao forte por desempenho foi detectada; manter estabilidade e reversibilidade."
                .to_string(),
        ));
    }

    None
}

fn has_category(findings: &[AdvisorAiFinding], category: AdvisorAiCategory) -> bool {
    findings
        .iter()
        .any(|finding| same_category(&finding.category, &category))
}

fn highest_severity_for(
    findings: &[AdvisorAiFinding],
    category: AdvisorAiCategory,
) -> AdvisorAiSeverity {
    findings
        .iter()
        .filter(|finding| same_category(&finding.category, &category))
        .map(|finding| finding.severity.clone())
        .max_by_key(severity_rank)
        .unwrap_or(AdvisorAiSeverity::Informational)
}

fn same_category(left: &AdvisorAiCategory, right: &AdvisorAiCategory) -> bool {
    std::mem::discriminant(left) == std::mem::discriminant(right)
}

fn severity_rank(severity: &AdvisorAiSeverity) -> u8 {
    match severity {
        AdvisorAiSeverity::Informational => 0,
        AdvisorAiSeverity::Low => 1,
        AdvisorAiSeverity::Medium => 2,
        AdvisorAiSeverity::High => 3,
        AdvisorAiSeverity::Critical => 4,
    }
}

fn percent(part: f32, total: f32) -> f32 {
    if total <= 0.0 {
        0.0
    } else {
        (part / total * 100.0).clamp(0.0, 100.0)
    }
}

fn is_balanced(value: &str) -> bool {
    let value = value.to_lowercase();
    value.contains("equilibr") || value.contains("balanced")
}

fn score_label(score: u8) -> &'static str {
    match score {
        90..=100 => "Excelente",
        75..=89 => "Saudavel",
        60..=74 => "Necessita otimizacao",
        40..=59 => "Atencao",
        _ => "Critico",
    }
}

fn general_state_label(score: &HermesScore, problem_count: usize) -> &'static str {
    if score.value.is_none() {
        "Analise limitada"
    } else if problem_count == 0 {
        "Sistema sem gargalos criticos detectados"
    } else {
        match score.value.unwrap_or_default() {
            90..=100 => "Excelente com pequenos pontos de melhoria",
            75..=89 => "Saudavel com oportunidades de otimizacao",
            60..=74 => "Necessita otimizacao",
            40..=59 => "Atencao recomendada",
            _ => "Estado critico",
        }
    }
}

fn now_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    seconds.to_string()
}
