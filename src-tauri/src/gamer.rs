use crate::{
    performance::{self, PerformanceApplyRequest, PerformanceApplyResult},
    restore::{
        self, RestoreCreateSnapshotRequest, RestorePlannedAction, RestorePreviousState,
        RestorePreviousStateCategory, RestoreRiskLevel, RestoreRollbackAction,
        RestoreRollbackActionStatus, RestoreRollbackActionType,
    },
    safe_mode,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const GAMER_COMMAND_TIMEOUT_SECONDS: u64 = 10;
const MAX_GAMER_EVENTS: usize = 100;
const MAX_GAMER_PROFILES: usize = 50;
const GAMER_PERFORMANCE_ACTION_IDS: &[&str] = &["set-high-performance-power-plan"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerReport {
    pub generated_at: String,
    pub engine_version: String,
    pub read_only: bool,
    pub will_modify_system: bool,
    pub telemetry: bool,
    pub resident_process: bool,
    pub active_game: GamerActiveGame,
    pub game_profiles: Vec<GamerGameProfile>,
    pub detected_games: Vec<GamerProcess>,
    pub suggested_processes: Vec<GamerProcess>,
    pub protected_processes: Vec<GamerProcess>,
    pub summary: GamerSummary,
    pub safeguards: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerActiveGame {
    pub detected: bool,
    pub confidence: GamerDetectionConfidence,
    pub pid: Option<u32>,
    pub process_name: Option<String>,
    pub display_name: Option<String>,
    pub executable_path: Option<String>,
    pub window_title: Option<String>,
    pub matched_profile: Option<GamerGameProfile>,
    pub recommended_plan: Option<String>,
    pub requires_manual_selection: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GamerDetectionConfidence {
    High,
    Medium,
    Low,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerGameProfile {
    pub id: String,
    pub game_name: String,
    pub executable: String,
    pub recommended_plan: String,
    pub allowed_processes_to_close: Vec<String>,
    pub protected_processes: Vec<String>,
    pub applied_actions: Vec<String>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerProfileList {
    pub generated_at: String,
    pub engine_version: String,
    pub total_profiles: usize,
    pub max_profiles: usize,
    pub profiles: Vec<GamerGameProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GamerGameProfileSaveRequest {
    pub id: Option<String>,
    pub game_name: String,
    pub executable: String,
    pub recommended_plan: Option<String>,
    pub allowed_processes_to_close: Option<Vec<String>>,
    pub protected_processes: Option<Vec<String>>,
    pub applied_actions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerSummary {
    pub detected_games: usize,
    pub suggested_to_close: usize,
    pub optional_to_close: usize,
    pub protected_count: usize,
    pub estimated_ram_to_free_mb: u64,
    pub overlay_count: usize,
    pub launcher_count: usize,
    pub steam_overlay_count: usize,
    pub xbox_overlay_count: usize,
    pub gpu_overlay_count: usize,
    pub streaming_exception_count: usize,
    pub emulator_exception_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerProcess {
    pub pid: u32,
    pub name: String,
    pub display_name: String,
    pub executable_path: Option<String>,
    pub command_line: Option<String>,
    pub memory_mb: u64,
    pub category: GamerProcessCategory,
    pub recommendation: GamerRecommendation,
    pub reason: String,
    pub can_close: bool,
    pub rollback_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GamerProcessCategory {
    Game,
    Launcher,
    Overlay,
    Communication,
    Browser,
    CloudSync,
    Creative,
    Background,
    System,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GamerRecommendation {
    Keep,
    OptionalClose,
    SuggestedClose,
    NeverClose,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GamerApplyRequest {
    pub confirmed: bool,
    pub dry_run: Option<bool>,
    pub process_ids: Option<Vec<u32>>,
    pub include_performance_profile: Option<bool>,
    pub game_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerApplyResult {
    pub generated_at: String,
    pub engine_version: String,
    pub dry_run: bool,
    pub snapshot_id: String,
    pub rollback_available: bool,
    pub post_game_restore_available: bool,
    pub active_game: GamerActiveGame,
    pub closed_processes: Vec<GamerCloseResult>,
    pub priority_result: Option<GamerPriorityResult>,
    pub performance_result: Option<PerformanceApplyResult>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerPriorityResult {
    pub pid: u32,
    pub name: String,
    pub status: GamerCloseStatus,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GamerRestoreSessionRequest {
    pub snapshot_id: String,
    pub confirmed: Option<bool>,
    pub dry_run: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerRestoreSessionResult {
    pub generated_at: String,
    pub engine_version: String,
    pub dry_run: bool,
    pub snapshot_id: String,
    pub restored: bool,
    pub restore_result: restore::RestoreApplyResult,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamerCloseResult {
    pub pid: u32,
    pub name: String,
    pub status: GamerCloseStatus,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GamerCloseStatus {
    DryRun,
    Closed,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GamerEvent {
    id: String,
    timestamp: String,
    snapshot_id: Option<String>,
    level: GamerEventLevel,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GamerEventLevel {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GamerEventHistory {
    events: Vec<GamerEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GamerProfileStore {
    profiles: Vec<GamerGameProfile>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawGamerReport {
    processes: Option<Vec<RawGamerProcess>>,
    active_process: Option<RawGamerProcess>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawGamerProcess {
    pid: Option<u32>,
    name: Option<String>,
    executable_path: Option<String>,
    command_line: Option<String>,
    memory_mb: Option<u64>,
    main_window_title: Option<String>,
}

#[tauri::command]
pub async fn gamer_engine_read(app: AppHandle) -> GamerReport {
    tauri::async_runtime::spawn_blocking(move || collect_gamer_report_with_app(Some(&app)))
        .await
        .unwrap_or_else(|err| {
            let mut report = build_report(
                fallback_raw_report(),
                Vec::new(),
                vec![format!("Falha ao ler Gamer Engine em segundo plano: {err}")],
            );
            report.engine_version = "gamer-engine-fallback-v1".to_string();
            report
        })
}

#[tauri::command]
pub async fn gamer_engine_apply(
    app: AppHandle,
    request: Option<GamerApplyRequest>,
) -> Result<GamerApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || gamer_engine_apply_blocking(app, request))
        .await
        .map_err(|err| format!("Falha ao aplicar Gamer Engine em segundo plano: {err}"))?
}

#[tauri::command]
pub async fn gamer_profiles_list(app: AppHandle) -> Result<GamerProfileList, String> {
    tauri::async_runtime::spawn_blocking(move || list_gamer_profiles(&app))
        .await
        .map_err(|err| format!("Falha ao listar perfis gamer em segundo plano: {err}"))?
}

#[tauri::command]
pub async fn gamer_profile_save(
    app: AppHandle,
    request: GamerGameProfileSaveRequest,
) -> Result<GamerGameProfile, String> {
    tauri::async_runtime::spawn_blocking(move || save_gamer_profile(&app, request))
        .await
        .map_err(|err| format!("Falha ao salvar perfil gamer em segundo plano: {err}"))?
}

#[tauri::command]
pub async fn gamer_profile_delete(
    app: AppHandle,
    profile_id: String,
) -> Result<GamerProfileList, String> {
    tauri::async_runtime::spawn_blocking(move || delete_gamer_profile(&app, &profile_id))
        .await
        .map_err(|err| format!("Falha ao remover perfil gamer em segundo plano: {err}"))?
}

#[tauri::command]
pub async fn gamer_restore_session(
    app: AppHandle,
    request: GamerRestoreSessionRequest,
) -> Result<GamerRestoreSessionResult, String> {
    tauri::async_runtime::spawn_blocking(move || gamer_restore_session_blocking(app, request))
        .await
        .map_err(|err| format!("Falha ao restaurar sessao gamer em segundo plano: {err}"))?
}

pub(crate) fn gamer_engine_apply_blocking(
    app: AppHandle,
    request: Option<GamerApplyRequest>,
) -> Result<GamerApplyResult, String> {
    let request = request.unwrap_or_default();
    let dry_run = safe_mode::force_dry_run(request.dry_run.unwrap_or(!request.confirmed));
    let include_performance_profile = request.include_performance_profile.unwrap_or(true);

    if !dry_run && !request.confirmed {
        return Err("Confirmacao obrigatoria antes de ativar a Gamer Engine.".to_string());
    }
    crate::licensing::require_real_license(dry_run)?;

    let report = collect_gamer_report_with_app(Some(&app));
    let selected_profile = select_game_profile(&report, request.game_profile_id.as_deref());
    let selected_processes = selected_processes_for_apply(
        &report,
        request.process_ids.as_deref(),
        selected_profile.as_ref(),
    );
    let snapshot_request = build_gamer_snapshot_request(
        &report,
        &selected_processes,
        include_performance_profile,
        dry_run,
    );
    let snapshot = restore::create_snapshot(app.clone(), Some(snapshot_request))?;

    append_gamer_event(
        &app,
        GamerEventLevel::Info,
        Some(snapshot.id.clone()),
        if dry_run {
            "DRY-RUN | Gamer Engine iniciou dry-run com snapshot obrigatorio."
        } else {
            "Gamer Engine iniciou aplicacao controlada apos confirmacao."
        },
    )?;

    let performance_result = if include_performance_profile {
        Some(performance::performance_apply_controlled(
            app.clone(),
            Some(PerformanceApplyRequest {
                confirmed: request.confirmed,
                dry_run: Some(dry_run),
                action_ids: Some(
                    GAMER_PERFORMANCE_ACTION_IDS
                        .iter()
                        .map(|item| item.to_string())
                        .collect(),
                ),
                reason: Some("Gamer Engine".to_string()),
            }),
        )?)
    } else {
        None
    };

    let closed_processes = if dry_run {
        selected_processes
            .iter()
            .map(|process| GamerCloseResult {
                pid: process.pid,
                name: process.display_name.clone(),
                status: GamerCloseStatus::DryRun,
                message: format!(
                    "{} — processo nao foi fechado.",
                    safe_mode::mode_prefix(dry_run)
                ),
            })
            .collect::<Vec<_>>()
    } else {
        close_selected_processes(&app, &snapshot.id, &selected_processes)?
    };
    let priority_result =
        apply_active_game_priority(&app, &snapshot.id, &report.active_game, dry_run)?;

    let failed = closed_processes
        .iter()
        .any(|item| matches!(item.status, GamerCloseStatus::Failed));
    let message = if failed {
        append_gamer_event(
            &app,
            GamerEventLevel::Warning,
            Some(snapshot.id.clone()),
            "Gamer Engine terminou com falhas em alguns processos. Rollback permanece disponivel.",
        )?;
        "Gamer Engine aplicada parcialmente. Veja os logs e o snapshot para reversao.".to_string()
    } else if dry_run {
        format!(
            "{} — Gamer Engine validada com snapshot, logs e rollback preparados. {}",
            safe_mode::mode_prefix(dry_run),
            if safe_mode::is_enabled() {
                safe_mode::notice()
            } else {
                ""
            }
        )
    } else {
        "Gamer Engine aplicada com fechamento gracioso e rollback disponivel.".to_string()
    };

    Ok(GamerApplyResult {
        generated_at: now_timestamp(),
        engine_version: "gamer-engine-v1".to_string(),
        dry_run,
        snapshot_id: snapshot.id,
        rollback_available: true,
        post_game_restore_available: true,
        active_game: report.active_game,
        closed_processes,
        priority_result,
        performance_result,
        message,
    })
}

pub fn collect_gamer_report() -> GamerReport {
    collect_gamer_report_with_app(None)
}

fn collect_gamer_report_with_app(app: Option<&AppHandle>) -> GamerReport {
    let profiles = app
        .and_then(|handle| read_gamer_profile_store(handle).ok())
        .map(|store| store.profiles)
        .unwrap_or_default();

    match collect_windows_processes() {
        Ok(raw) => build_report(raw, profiles, Vec::new()),
        Err(error) => {
            let mut report = build_report(fallback_raw_report(), profiles, vec![error]);
            report
                .warnings
                .push("Fallback indisponivel usado porque a leitura real nao respondeu. Nenhum processo demonstrativo foi retornado.".to_string());
            report
        }
    }
}

fn collect_windows_processes() -> Result<RawGamerReport, String> {
    if !cfg!(target_os = "windows") {
        return Err("Gamer Engine usa leitura local de processos do Windows.".to_string());
    }

    let stdout = run_powershell(POWERSHELL_GAMER_PROCESS_SCRIPT)?;
    serde_json::from_str::<RawGamerReport>(&stdout)
        .map_err(|err| format!("Nao foi possivel interpretar processos da Gamer Engine: {err}"))
}

fn build_report(
    raw: RawGamerReport,
    game_profiles: Vec<GamerGameProfile>,
    mut warnings: Vec<String>,
) -> GamerReport {
    let mut processes = raw
        .processes
        .clone()
        .unwrap_or_default()
        .into_iter()
        .filter_map(build_process)
        .collect::<Vec<_>>();

    processes.sort_by(|a, b| {
        recommendation_rank(&a.recommendation)
            .cmp(&recommendation_rank(&b.recommendation))
            .then_with(|| b.memory_mb.cmp(&a.memory_mb))
            .then_with(|| a.display_name.cmp(&b.display_name))
    });

    let detected_games = processes
        .iter()
        .filter(|process| process.category == GamerProcessCategory::Game)
        .cloned()
        .collect::<Vec<_>>();
    let suggested_processes = processes
        .iter()
        .filter(|process| {
            matches!(
                process.recommendation,
                GamerRecommendation::SuggestedClose | GamerRecommendation::OptionalClose
            )
        })
        .cloned()
        .collect::<Vec<_>>();
    let protected_processes = processes
        .iter()
        .filter(|process| process.recommendation == GamerRecommendation::NeverClose)
        .cloned()
        .collect::<Vec<_>>();
    let estimated_ram_to_free_mb = suggested_processes
        .iter()
        .filter(|process| process.recommendation == GamerRecommendation::SuggestedClose)
        .map(|process| process.memory_mb)
        .sum();
    let active_game = detect_active_game(
        raw.active_process.as_ref(),
        &processes,
        &game_profiles,
        &mut warnings,
    );

    GamerReport {
        generated_at: now_timestamp(),
        engine_version: "gamer-engine-v1".to_string(),
        read_only: true,
        will_modify_system: false,
        telemetry: false,
        resident_process: false,
        active_game,
        game_profiles,
        summary: GamerSummary {
            detected_games: detected_games.len(),
            suggested_to_close: suggested_processes
                .iter()
                .filter(|process| process.recommendation == GamerRecommendation::SuggestedClose)
                .count(),
            optional_to_close: suggested_processes
                .iter()
                .filter(|process| process.recommendation == GamerRecommendation::OptionalClose)
                .count(),
            protected_count: protected_processes.len(),
            estimated_ram_to_free_mb,
            overlay_count: processes
                .iter()
                .filter(|process| process.category == GamerProcessCategory::Overlay)
                .count(),
            launcher_count: processes
                .iter()
                .filter(|process| process.category == GamerProcessCategory::Launcher)
                .count(),
            steam_overlay_count: processes
                .iter()
                .filter(|process| process_matches_any(process, steam_overlay_patterns()))
                .count(),
            xbox_overlay_count: processes
                .iter()
                .filter(|process| process_matches_any(process, xbox_overlay_patterns()))
                .count(),
            gpu_overlay_count: processes
                .iter()
                .filter(|process| process_matches_any(process, gpu_overlay_patterns()))
                .count(),
            streaming_exception_count: processes
                .iter()
                .filter(|process| {
                    is_streaming_exception_process(
                        &process.name,
                        process.executable_path.as_deref(),
                    )
                })
                .count(),
            emulator_exception_count: processes
                .iter()
                .filter(|process| {
                    is_emulator_exception_process(&process.name, process.executable_path.as_deref())
                })
                .count(),
        },
        detected_games,
        suggested_processes,
        protected_processes,
        safeguards: vec![
            "Nunca fecha processos criticos do Windows.".to_string(),
            "Fechamento real exige confirmacao.".to_string(),
            "Usa CloseMainWindow; nao usa kill forcado.".to_string(),
            "Snapshot e log local antes de qualquer aplicacao.".to_string(),
            "Rollback tenta reabrir apps fechados quando o executavel foi capturado.".to_string(),
        ],
        warnings,
    }
}

fn build_process(raw: RawGamerProcess) -> Option<GamerProcess> {
    let pid = raw.pid?;
    let name = value_or(raw.name, "processo.exe");
    let display_name = name.trim_end_matches(".exe").to_string();
    let executable_path = clean_optional(raw.executable_path);
    let command_line = clean_optional(raw.command_line);
    let memory_mb = raw.memory_mb.unwrap_or_default();
    let window_title = raw.main_window_title.unwrap_or_default();
    let category = classify_category(&name, executable_path.as_deref(), &window_title);
    let recommendation = recommendation_for(&name, &category, executable_path.as_deref());
    let can_close = matches!(
        recommendation,
        GamerRecommendation::SuggestedClose | GamerRecommendation::OptionalClose
    ) && executable_path.is_some();
    let rollback_available = can_close && executable_path.is_some();
    let reason = reason_for(&category, &recommendation);

    Some(GamerProcess {
        pid,
        name,
        display_name,
        executable_path,
        command_line,
        memory_mb,
        category,
        recommendation,
        reason,
        can_close,
        rollback_available,
    })
}

fn detect_active_game(
    raw_active: Option<&RawGamerProcess>,
    processes: &[GamerProcess],
    profiles: &[GamerGameProfile],
    warnings: &mut Vec<String>,
) -> GamerActiveGame {
    let Some(raw_process) = raw_active.cloned() else {
        warnings.push(
            "Processo em primeiro plano indisponivel; selecao manual pode ser necessaria."
                .to_string(),
        );
        return unavailable_active_game(
            "Nao foi possivel detectar com seguranca o jogo ativo. Selecione manualmente antes de aplicar o modo gamer.",
        );
    };

    let Some(active_process) = build_process(raw_process.clone()) else {
        warnings.push(
            "Processo em primeiro plano sem PID valido; selecao manual pode ser necessaria."
                .to_string(),
        );
        return unavailable_active_game(
            "Processo em primeiro plano nao possui dados suficientes para deteccao gamer.",
        );
    };

    let matched_profile = profiles
        .iter()
        .find(|profile| profile_matches_process(profile, &active_process))
        .cloned();
    let known_process = processes
        .iter()
        .find(|process| process.pid == active_process.pid)
        .cloned()
        .unwrap_or_else(|| active_process.clone());
    let looks_like_game_path = looks_like_game_path(known_process.executable_path.as_deref());
    let confidence =
        if matched_profile.is_some() || known_process.category == GamerProcessCategory::Game {
            GamerDetectionConfidence::High
        } else if looks_like_game_path {
            GamerDetectionConfidence::Medium
        } else if known_process.executable_path.is_some()
            && !matches!(
                known_process.category,
                GamerProcessCategory::System
                    | GamerProcessCategory::Browser
                    | GamerProcessCategory::Communication
                    | GamerProcessCategory::CloudSync
            )
        {
            GamerDetectionConfidence::Low
        } else {
            GamerDetectionConfidence::Low
        };
    let detected = matches!(
        confidence,
        GamerDetectionConfidence::High | GamerDetectionConfidence::Medium
    );
    let requires_manual_selection = !detected || confidence == GamerDetectionConfidence::Low;
    let recommended_plan = matched_profile
        .as_ref()
        .map(|profile| profile.recommended_plan.clone())
        .or_else(|| {
            if detected {
                Some("alto-desempenho".to_string())
            } else {
                None
            }
        });
    let message = match confidence {
        GamerDetectionConfidence::High => {
            "Jogo ativo identificado com alta confianca por perfil salvo ou lista conhecida."
                .to_string()
        }
        GamerDetectionConfidence::Medium => {
            "Processo em primeiro plano parece ser um jogo pelo caminho do executavel.".to_string()
        }
        GamerDetectionConfidence::Low => {
            "Processo em primeiro plano detectado, mas a confianca e baixa. Selecao manual recomendada."
                .to_string()
        }
        GamerDetectionConfidence::Unavailable => {
            "Deteccao de jogo ativo indisponivel.".to_string()
        }
    };

    GamerActiveGame {
        detected,
        confidence,
        pid: Some(known_process.pid),
        process_name: Some(known_process.name.clone()),
        display_name: Some(known_process.display_name.clone()),
        executable_path: known_process.executable_path.clone(),
        window_title: clean_optional(raw_process.main_window_title),
        matched_profile,
        recommended_plan,
        requires_manual_selection,
        message,
    }
}

fn unavailable_active_game(message: &str) -> GamerActiveGame {
    GamerActiveGame {
        detected: false,
        confidence: GamerDetectionConfidence::Unavailable,
        pid: None,
        process_name: None,
        display_name: None,
        executable_path: None,
        window_title: None,
        matched_profile: None,
        recommended_plan: None,
        requires_manual_selection: true,
        message: message.to_string(),
    }
}

fn classify_category(
    name: &str,
    executable_path: Option<&str>,
    window_title: &str,
) -> GamerProcessCategory {
    let haystack = format!(
        "{} {} {}",
        name.to_ascii_lowercase(),
        executable_path.unwrap_or_default().to_ascii_lowercase(),
        window_title.to_ascii_lowercase()
    );

    if is_critical_process(&haystack) {
        GamerProcessCategory::System
    } else if contains_any(&haystack, game_patterns()) {
        GamerProcessCategory::Game
    } else if contains_any(&haystack, launcher_patterns()) {
        GamerProcessCategory::Launcher
    } else if contains_any(&haystack, overlay_patterns()) {
        GamerProcessCategory::Overlay
    } else if contains_any(&haystack, communication_patterns()) {
        GamerProcessCategory::Communication
    } else if contains_any(&haystack, browser_patterns()) {
        GamerProcessCategory::Browser
    } else if contains_any(&haystack, cloud_patterns()) {
        GamerProcessCategory::CloudSync
    } else if contains_any(&haystack, creative_patterns()) {
        GamerProcessCategory::Creative
    } else if contains_any(&haystack, background_patterns()) {
        GamerProcessCategory::Background
    } else {
        GamerProcessCategory::Unknown
    }
}

fn recommendation_for(
    name: &str,
    category: &GamerProcessCategory,
    executable_path: Option<&str>,
) -> GamerRecommendation {
    let normalized = name.to_ascii_lowercase();
    if is_critical_process(&normalized) {
        return GamerRecommendation::NeverClose;
    }
    if is_streaming_exception_process(&normalized, executable_path) {
        return GamerRecommendation::NeverClose;
    }
    if is_emulator_exception_process(&normalized, executable_path) {
        return GamerRecommendation::NeverClose;
    }
    if is_primary_discord_process(&normalized) {
        return GamerRecommendation::NeverClose;
    }
    if is_primary_steam_process(&normalized) {
        return GamerRecommendation::NeverClose;
    }

    match category {
        GamerProcessCategory::Game | GamerProcessCategory::System => {
            GamerRecommendation::NeverClose
        }
        GamerProcessCategory::Launcher => GamerRecommendation::OptionalClose,
        GamerProcessCategory::Overlay
        | GamerProcessCategory::Communication
        | GamerProcessCategory::CloudSync => {
            if executable_path.is_some() {
                GamerRecommendation::SuggestedClose
            } else {
                GamerRecommendation::OptionalClose
            }
        }
        GamerProcessCategory::Browser | GamerProcessCategory::Creative => {
            if executable_path.is_some() {
                GamerRecommendation::OptionalClose
            } else {
                GamerRecommendation::Keep
            }
        }
        GamerProcessCategory::Background | GamerProcessCategory::Unknown => {
            GamerRecommendation::Keep
        }
    }
}

fn is_primary_discord_process(normalized_name: &str) -> bool {
    matches!(normalized_name, "discord.exe" | "discord")
}

fn is_primary_steam_process(normalized_name: &str) -> bool {
    matches!(
        normalized_name,
        "steam.exe" | "steam" | "steamwebhelper.exe" | "steamwebhelper"
    )
}

fn reason_for(category: &GamerProcessCategory, recommendation: &GamerRecommendation) -> String {
    match recommendation {
        GamerRecommendation::NeverClose => {
            "Protegido para evitar instabilidade durante o jogo.".to_string()
        }
        GamerRecommendation::Keep => {
            "Mantido por padrao; pode ser necessario para o jogo.".to_string()
        }
        GamerRecommendation::OptionalClose => match category {
            GamerProcessCategory::Launcher => {
                "Launcher pode consumir recursos, mas alguns jogos dependem dele. Fechamento somente opcional.".to_string()
            }
            GamerProcessCategory::Browser => {
                "Pode consumir RAM/CPU, mas pode conter abas importantes.".to_string()
            }
            GamerProcessCategory::Creative => {
                "Pode consumir muitos recursos, mas fechamento deve ser opcional.".to_string()
            }
            _ => "Fechamento opcional para liberar recursos.".to_string(),
        },
        GamerRecommendation::SuggestedClose => match category {
            GamerProcessCategory::Overlay => {
                "Overlay pode interferir em FPS, foco ou latencia.".to_string()
            }
            GamerProcessCategory::Communication => {
                "App de comunicacao pode consumir RAM/CPU em segundo plano.".to_string()
            }
            GamerProcessCategory::CloudSync => {
                "Sincronizacao pode disputar disco e rede durante jogos.".to_string()
            }
            _ => "Processo nao essencial sugerido para fechar antes de jogar.".to_string(),
        },
    }
}

fn selected_processes_for_apply(
    report: &GamerReport,
    process_ids: Option<&[u32]>,
    profile: Option<&GamerGameProfile>,
) -> Vec<GamerProcess> {
    let selected_ids = process_ids
        .map(|items| items.iter().copied().collect::<HashSet<_>>())
        .unwrap_or_default();
    report
        .suggested_processes
        .iter()
        .filter(|process| {
            if profile
                .map(|item| profile_protects_process(item, process))
                .unwrap_or(false)
            {
                return false;
            }

            let explicit_selection = !selected_ids.is_empty();
            let profile_allowed = profile
                .map(|item| profile_allows_process_close(item, process))
                .unwrap_or(false);
            let recommendation_allowed = if explicit_selection || profile_allowed {
                matches!(
                    process.recommendation,
                    GamerRecommendation::SuggestedClose | GamerRecommendation::OptionalClose
                )
            } else {
                process.recommendation == GamerRecommendation::SuggestedClose
            };

            process.can_close
                && process.rollback_available
                && (selected_ids.is_empty() || selected_ids.contains(&process.pid))
                && recommendation_allowed
        })
        .cloned()
        .collect()
}

fn select_game_profile(
    report: &GamerReport,
    requested_id: Option<&str>,
) -> Option<GamerGameProfile> {
    requested_id
        .and_then(|id| report.game_profiles.iter().find(|profile| profile.id == id))
        .cloned()
        .or_else(|| report.active_game.matched_profile.clone())
}

fn list_gamer_profiles(app: &AppHandle) -> Result<GamerProfileList, String> {
    let store = read_gamer_profile_store(app)?;
    Ok(GamerProfileList {
        generated_at: now_timestamp(),
        engine_version: "gamer-profiles-v1".to_string(),
        total_profiles: store.profiles.len(),
        max_profiles: MAX_GAMER_PROFILES,
        profiles: store.profiles,
    })
}

fn save_gamer_profile(
    app: &AppHandle,
    request: GamerGameProfileSaveRequest,
) -> Result<GamerGameProfile, String> {
    let game_name = request.game_name.trim();
    let executable = request.executable.trim();
    if game_name.is_empty() {
        return Err("Nome do jogo e obrigatorio para salvar perfil gamer.".to_string());
    }
    if executable.is_empty() {
        return Err("Executavel/processo e obrigatorio para salvar perfil gamer.".to_string());
    }

    let mut store = read_gamer_profile_store(app)?;
    let id = request
        .id
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| item.to_string())
        .unwrap_or_else(|| {
            format!(
                "game-profile-{}-{}",
                sanitize_profile_id(game_name),
                now_nanos()
            )
        });
    let profile = GamerGameProfile {
        id: id.clone(),
        game_name: game_name.to_string(),
        executable: executable.to_string(),
        recommended_plan: request
            .recommended_plan
            .as_deref()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .unwrap_or("alto-desempenho")
            .to_string(),
        allowed_processes_to_close: normalize_name_list(
            request.allowed_processes_to_close.unwrap_or_default(),
        ),
        protected_processes: normalized_profile_protected_processes(
            request.protected_processes.unwrap_or_default(),
        ),
        applied_actions: normalize_name_list(request.applied_actions.unwrap_or_default()),
        timestamp: now_timestamp(),
    };

    if let Some(index) = store.profiles.iter().position(|item| item.id == id) {
        store.profiles[index] = profile.clone();
    } else {
        store.profiles.insert(0, profile.clone());
    }
    store.profiles.truncate(MAX_GAMER_PROFILES);
    write_gamer_profile_store(app, &store)?;
    append_gamer_event(
        app,
        GamerEventLevel::Info,
        None,
        &format!("Perfil gamer salvo para {}.", profile.game_name),
    )?;
    Ok(profile)
}

fn delete_gamer_profile(app: &AppHandle, profile_id: &str) -> Result<GamerProfileList, String> {
    let mut store = read_gamer_profile_store(app)?;
    let before = store.profiles.len();
    store.profiles.retain(|profile| profile.id != profile_id);
    if before == store.profiles.len() {
        return Err(format!("Perfil gamer nao encontrado: {profile_id}"));
    }

    write_gamer_profile_store(app, &store)?;
    append_gamer_event(
        app,
        GamerEventLevel::Info,
        None,
        &format!("Perfil gamer removido: {profile_id}."),
    )?;
    list_gamer_profiles(app)
}

fn gamer_restore_session_blocking(
    app: AppHandle,
    request: GamerRestoreSessionRequest,
) -> Result<GamerRestoreSessionResult, String> {
    let dry_run = safe_mode::force_dry_run(
        request
            .dry_run
            .unwrap_or(!request.confirmed.unwrap_or(false)),
    );
    if !dry_run && !request.confirmed.unwrap_or(false) {
        return Err("Confirmacao obrigatoria antes de restaurar sessao gamer.".to_string());
    }

    append_gamer_event(
        &app,
        GamerEventLevel::Info,
        Some(request.snapshot_id.clone()),
        if dry_run {
            "Restauracao pos-jogo iniciada em dry-run."
        } else {
            "Restauracao pos-jogo iniciada apos confirmacao."
        },
    )?;

    let restore_result =
        restore::restore_apply_snapshot(app.clone(), request.snapshot_id.clone(), Some(dry_run))?;
    let restored = restore_result.applied;
    append_gamer_event(
        &app,
        if restored || dry_run {
            GamerEventLevel::Info
        } else {
            GamerEventLevel::Warning
        },
        Some(request.snapshot_id.clone()),
        &format!("Restauracao pos-jogo: {}", restore_result.message),
    )?;

    Ok(GamerRestoreSessionResult {
        generated_at: now_timestamp(),
        engine_version: "gamer-engine-restore-v1".to_string(),
        dry_run,
        snapshot_id: request.snapshot_id,
        restored,
        message: if dry_run {
            "Dry-run de restauracao pos-jogo concluido.".to_string()
        } else if restored {
            "Sessao gamer restaurada com o Restore Engine.".to_string()
        } else {
            "Restore Engine retornou itens pendentes, pulados ou nao suportados.".to_string()
        },
        restore_result,
    })
}

fn build_gamer_snapshot_request(
    report: &GamerReport,
    processes: &[GamerProcess],
    include_performance_profile: bool,
    dry_run: bool,
) -> RestoreCreateSnapshotRequest {
    let mode = if dry_run { "dry-run" } else { "aplicacao real" };
    let mut planned_actions = processes
        .iter()
        .map(process_to_planned_action)
        .collect::<Vec<_>>();
    if include_performance_profile {
        planned_actions.push(RestorePlannedAction {
            id: "gamer-performance-profile".to_string(),
            engine: "Gamer Engine".to_string(),
            title: "Aplicar ajustes de desempenho gamer".to_string(),
            description:
                "Encaminha somente plano de energia gamer; efeitos visuais ficam separados e opt-in."
                    .to_string(),
            risk: RestoreRiskLevel::Medium,
            will_modify_system: true,
            requires_admin: false,
        });
    }
    if report.active_game.detected {
        planned_actions.push(RestorePlannedAction {
            id: "gamer-active-priority-high".to_string(),
            engine: "Gamer Engine".to_string(),
            title: "Priorizar jogo ativo".to_string(),
            description: "Ajuste transiente para prioridade alta do processo de jogo detectado."
                .to_string(),
            risk: RestoreRiskLevel::Low,
            will_modify_system: true,
            requires_admin: false,
        });
    }

    RestoreCreateSnapshotRequest {
        name: Some("Gamer Engine - Snapshot de seguranca".to_string()),
        description: Some(format!(
            "Snapshot obrigatorio antes da {mode} do Modo Gamer. Processos planejados: {}.",
            processes.len()
        )),
        planned_actions: Some(planned_actions),
        rollback_manifest: Some(processes.iter().filter_map(process_to_rollback).collect()),
        previous_state: Some(gamer_previous_state(report, processes)),
    }
}

fn process_to_planned_action(process: &GamerProcess) -> RestorePlannedAction {
    RestorePlannedAction {
        id: format!("gamer-close-{}", process.pid),
        engine: "Gamer Engine".to_string(),
        title: format!("Fechar {}", process.display_name),
        description: format!(
            "Fechamento gracioso para liberar {} MB de RAM.",
            process.memory_mb
        ),
        risk: RestoreRiskLevel::Medium,
        will_modify_system: true,
        requires_admin: false,
    }
}

fn process_to_rollback(process: &GamerProcess) -> Option<RestoreRollbackAction> {
    let executable_path = process.executable_path.clone()?;
    Some(RestoreRollbackAction {
        id: format!("rollback-gamer-process-{}", process.pid),
        action_type: RestoreRollbackActionType::Custom,
        target: executable_path,
        description: format!(
            "Reabrir {} se o usuario desejar restaurar a sessao.",
            process.display_name
        ),
        previous_value: None,
        backup_path: None,
        command_preview: Some("Start-Process".to_string()),
        status: RestoreRollbackActionStatus::Pending,
    })
}

fn process_to_previous_state(process: &GamerProcess) -> RestorePreviousState {
    RestorePreviousState {
        key: format!("gamer-process-{}", process.pid),
        category: RestorePreviousStateCategory::Metadata,
        value: format!(
            "{} | {} MB | {}",
            process.display_name,
            process.memory_mb,
            process
                .executable_path
                .clone()
                .unwrap_or_else(|| "executavel nao capturado".to_string())
        ),
        source: "Win32_Process/Get-Process".to_string(),
        captured: process.executable_path.is_some(),
    }
}

fn gamer_previous_state(
    report: &GamerReport,
    processes: &[GamerProcess],
) -> Vec<RestorePreviousState> {
    let mut state = processes
        .iter()
        .map(process_to_previous_state)
        .collect::<Vec<_>>();

    state.push(RestorePreviousState {
        key: "gamer-active-game".to_string(),
        category: RestorePreviousStateCategory::Metadata,
        value: report
            .active_game
            .display_name
            .clone()
            .unwrap_or_else(|| "indisponivel".to_string()),
        source: "ForegroundWindow/Get-Process".to_string(),
        captured: report.active_game.detected,
    });

    if let Some(profile) = report.active_game.matched_profile.as_ref() {
        state.push(RestorePreviousState {
            key: "gamer-active-profile".to_string(),
            category: RestorePreviousStateCategory::Metadata,
            value: format!("{} | {}", profile.game_name, profile.executable),
            source: "NEX gamer_profiles.json".to_string(),
            captured: true,
        });
    }
    if report.active_game.detected {
        state.push(RestorePreviousState {
            key: "gamer-active-priority".to_string(),
            category: RestorePreviousStateCategory::Metadata,
            value: format!(
                "{} | PID {}",
                report
                    .active_game
                    .display_name
                    .clone()
                    .unwrap_or_else(|| "jogo ativo".to_string()),
                report
                    .active_game
                    .pid
                    .map(|pid| pid.to_string())
                    .unwrap_or_else(|| "indisponivel".to_string())
            ),
            source: "Gamer Engine priority transient".to_string(),
            captured: report.active_game.pid.is_some(),
        });
    }

    state
}

fn close_selected_processes(
    app: &AppHandle,
    snapshot_id: &str,
    processes: &[GamerProcess],
) -> Result<Vec<GamerCloseResult>, String> {
    let mut results = Vec::new();
    for process in processes {
        let result = close_process_gracefully(process);
        let level = if matches!(result.status, GamerCloseStatus::Failed) {
            GamerEventLevel::Error
        } else {
            GamerEventLevel::Info
        };
        append_gamer_event(
            app,
            level,
            Some(snapshot_id.to_string()),
            &format!("{}: {}", process.display_name, result.message),
        )?;
        results.push(result);
    }

    Ok(results)
}

fn apply_active_game_priority(
    app: &AppHandle,
    snapshot_id: &str,
    active_game: &GamerActiveGame,
    dry_run: bool,
) -> Result<Option<GamerPriorityResult>, String> {
    if !active_game.detected {
        return Ok(None);
    }

    let Some(pid) = active_game.pid else {
        return Ok(None);
    };

    if !is_allowed_priority_game(active_game) {
        return Ok(Some(GamerPriorityResult {
            pid,
            name: active_game
                .display_name
                .clone()
                .unwrap_or_else(|| "Jogo ativo".to_string()),
            status: GamerCloseStatus::Skipped,
            message: "Prioridade nao aplicada: alvo nao entrou na allowlist gamer.".to_string(),
        }));
    }

    let name = active_game.display_name.clone().unwrap_or_else(|| {
        active_game
            .process_name
            .clone()
            .unwrap_or_else(|| "Jogo ativo".to_string())
    });

    let result = if dry_run {
        GamerPriorityResult {
            pid,
            name,
            status: GamerCloseStatus::DryRun,
            message: format!(
                "{} - prioridade alta validada; processo nao foi alterado.",
                safe_mode::mode_prefix(dry_run)
            ),
        }
    } else {
        match set_process_priority_high(pid) {
            Ok(()) => GamerPriorityResult {
                pid,
                name,
                status: GamerCloseStatus::Closed,
                message: "Prioridade alta aplicada ao jogo ativo.".to_string(),
            },
            Err(error) => GamerPriorityResult {
                pid,
                name,
                status: GamerCloseStatus::Failed,
                message: error,
            },
        }
    };

    append_gamer_event(
        app,
        if matches!(result.status, GamerCloseStatus::Failed) {
            GamerEventLevel::Warning
        } else {
            GamerEventLevel::Info
        },
        Some(snapshot_id.to_string()),
        &format!("Prioridade gamer: {}", result.message),
    )?;

    Ok(Some(result))
}

fn set_process_priority_high(pid: u32) -> Result<(), String> {
    let script = format!(
        "$ErrorActionPreference = 'Stop'; $p = Get-Process -Id {pid} -ErrorAction Stop; $p.PriorityClass = 'High'; 'ok'"
    );
    run_powershell(&script).map(|_| ())
}

fn close_process_gracefully(process: &GamerProcess) -> GamerCloseResult {
    if !process.can_close || !process.rollback_available {
        return GamerCloseResult {
            pid: process.pid,
            name: process.display_name.clone(),
            status: GamerCloseStatus::Skipped,
            message: "Processo nao atende aos criterios seguros de fechamento.".to_string(),
        };
    }

    if is_critical_process(&process.name) {
        return GamerCloseResult {
            pid: process.pid,
            name: process.display_name.clone(),
            status: GamerCloseStatus::Skipped,
            message: "Processo protegido pela denylist NEX.".to_string(),
        };
    }

    let script = format!(
        "$ErrorActionPreference = 'Stop'; $p = [System.Diagnostics.Process]::GetProcessById({}); if ($null -eq $p) {{ throw 'Processo nao encontrado' }}; if ($p.CloseMainWindow()) {{ $p.WaitForExit(5000) | Out-Null; if ($p.HasExited) {{ 'closed' }} else {{ 'still-running' }} }} else {{ 'no-window' }}",
        process.pid
    );

    match run_powershell(&script) {
        Ok(output) if output.contains("closed") => GamerCloseResult {
            pid: process.pid,
            name: process.display_name.clone(),
            status: GamerCloseStatus::Closed,
            message: "Janela fechada de forma graciosa.".to_string(),
        },
        Ok(output) if output.contains("still-running") => GamerCloseResult {
            pid: process.pid,
            name: process.display_name.clone(),
            status: GamerCloseStatus::Skipped,
            message: "Aplicativo nao encerrou dentro do tempo; nenhum kill forcado foi usado."
                .to_string(),
        },
        Ok(output) if output.contains("no-window") => GamerCloseResult {
            pid: process.pid,
            name: process.display_name.clone(),
            status: GamerCloseStatus::Skipped,
            message: "Processo sem janela principal; fechamento forcado bloqueado.".to_string(),
        },
        Ok(_) => GamerCloseResult {
            pid: process.pid,
            name: process.display_name.clone(),
            status: GamerCloseStatus::Skipped,
            message: "Nenhuma acao aplicada ao processo.".to_string(),
        },
        Err(error) => GamerCloseResult {
            pid: process.pid,
            name: process.display_name.clone(),
            status: GamerCloseStatus::Failed,
            message: error,
        },
    }
}

fn append_gamer_event(
    app: &AppHandle,
    level: GamerEventLevel,
    snapshot_id: Option<String>,
    message: &str,
) -> Result<(), String> {
    let path = gamer_events_path(app)?;
    let mut history = read_gamer_event_history(&path);
    history.events.insert(
        0,
        GamerEvent {
            id: format!("gamer-event-{}-{}", now_timestamp(), now_nanos()),
            timestamp: now_timestamp(),
            snapshot_id,
            level,
            message: message.to_string(),
        },
    );
    history.events.truncate(MAX_GAMER_EVENTS);
    write_gamer_event_history(&path, &history)
}

fn gamer_events_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Nao foi possivel localizar AppData: {err}"))?;
    dir.push("history");
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Nao foi possivel criar historico gamer: {err}"))?;
    dir.push("gamer_events.json");
    Ok(dir)
}

fn gamer_profiles_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Nao foi possivel localizar AppData: {err}"))?;
    dir.push("history");
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Nao foi possivel criar pasta de perfis gamer: {err}"))?;
    dir.push("gamer_profiles.json");
    Ok(dir)
}

fn read_gamer_profile_store(app: &AppHandle) -> Result<GamerProfileStore, String> {
    let path = gamer_profiles_path(app)?;
    let Ok(contents) = fs::read_to_string(&path) else {
        return Ok(GamerProfileStore::default());
    };
    serde_json::from_str(&contents)
        .map_err(|err| format!("Nao foi possivel ler perfis gamer: {err}"))
}

fn write_gamer_profile_store(app: &AppHandle, store: &GamerProfileStore) -> Result<(), String> {
    let path = gamer_profiles_path(app)?;
    let contents = serde_json::to_string_pretty(store)
        .map_err(|err| format!("Nao foi possivel serializar perfis gamer: {err}"))?;
    fs::write(path, contents).map_err(|err| format!("Nao foi possivel gravar perfis gamer: {err}"))
}

fn profile_matches_process(profile: &GamerGameProfile, process: &GamerProcess) -> bool {
    executable_matches(
        &profile.executable,
        &process.name,
        process.executable_path.as_deref(),
    )
}

fn profile_protects_process(profile: &GamerGameProfile, process: &GamerProcess) -> bool {
    profile
        .protected_processes
        .iter()
        .any(|item| executable_matches(item, &process.name, process.executable_path.as_deref()))
        || is_critical_process(&process.name)
}

fn profile_allows_process_close(profile: &GamerGameProfile, process: &GamerProcess) -> bool {
    if profile.allowed_processes_to_close.is_empty() {
        return false;
    }

    profile
        .allowed_processes_to_close
        .iter()
        .any(|item| executable_matches(item, &process.name, process.executable_path.as_deref()))
}

fn executable_matches(pattern: &str, process_name: &str, executable_path: Option<&str>) -> bool {
    let normalized_pattern = normalize_executable_pattern(pattern);
    if normalized_pattern.is_empty() {
        return false;
    }

    let normalized_name = normalize_executable_pattern(process_name);
    let normalized_path = executable_path
        .map(normalize_executable_pattern)
        .unwrap_or_default();

    normalized_name == normalized_pattern
        || normalized_name.trim_end_matches(".exe") == normalized_pattern.trim_end_matches(".exe")
        || (!normalized_path.is_empty()
            && (normalized_path == normalized_pattern
                || normalized_path.ends_with(&format!("\\{normalized_pattern}"))
                || normalized_path.ends_with(&format!("/{normalized_pattern}"))))
}

fn looks_like_game_path(executable_path: Option<&str>) -> bool {
    let Some(path) = executable_path else {
        return false;
    };
    let normalized = path.to_ascii_lowercase();
    contains_any(
        &normalized,
        &[
            "\\steamapps\\common\\",
            "\\epic games\\",
            "\\riot games\\",
            "\\xboxgames\\",
            "\\gog galaxy\\games\\",
            "\\ea games\\",
            "\\battle.net\\",
            "\\ubisoft\\",
            "\\unrealengine\\",
            "\\unreal engine\\",
            "\\steamapps\\common\\fate trigger\\",
            "\\steamapps\\common\\fatetrigger\\",
            "\\fatetrigger\\",
            "\\fate trigger\\",
        ],
    )
}

fn normalized_profile_protected_processes(items: Vec<String>) -> Vec<String> {
    let mut names = normalize_name_list(items);
    for item in critical_process_names() {
        if !names.iter().any(|name| name == item) {
            names.push((*item).to_string());
        }
    }
    names
}

fn normalize_name_list(items: Vec<String>) -> Vec<String> {
    let mut names = items
        .into_iter()
        .map(|item| normalize_executable_pattern(&item))
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
}

fn normalize_executable_pattern(value: &str) -> String {
    value.trim().trim_matches('"').to_ascii_lowercase()
}

fn sanitize_profile_id(value: &str) -> String {
    let mut id = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    while id.contains("--") {
        id = id.replace("--", "-");
    }
    id.trim_matches('-').to_string()
}

fn read_gamer_event_history(path: &PathBuf) -> GamerEventHistory {
    let Ok(contents) = fs::read_to_string(path) else {
        return GamerEventHistory::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_gamer_event_history(path: &PathBuf, history: &GamerEventHistory) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(history)
        .map_err(|err| format!("Nao foi possivel serializar logs gamer: {err}"))?;
    fs::write(path, contents).map_err(|err| format!("Nao foi possivel gravar logs gamer: {err}"))
}

fn recommendation_rank(recommendation: &GamerRecommendation) -> u8 {
    match recommendation {
        GamerRecommendation::SuggestedClose => 0,
        GamerRecommendation::OptionalClose => 1,
        GamerRecommendation::Keep => 2,
        GamerRecommendation::NeverClose => 3,
    }
}

fn contains_any(value: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|pattern| value.contains(pattern))
}

fn is_critical_process(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    contains_any(&normalized, critical_process_names())
}

fn process_matches_any(process: &GamerProcess, patterns: &[&str]) -> bool {
    let haystack = format!(
        "{} {} {}",
        process.name.to_ascii_lowercase(),
        process
            .executable_path
            .clone()
            .unwrap_or_default()
            .to_ascii_lowercase(),
        process
            .command_line
            .clone()
            .unwrap_or_default()
            .to_ascii_lowercase()
    );
    contains_any(&haystack, patterns)
}

fn is_streaming_exception_process(name: &str, executable_path: Option<&str>) -> bool {
    let haystack = format!(
        "{} {}",
        name.to_ascii_lowercase(),
        executable_path.unwrap_or_default().to_ascii_lowercase()
    );
    contains_any(&haystack, &["obs", "obs64", "obs32", "obs-studio"])
}

fn is_emulator_exception_process(name: &str, executable_path: Option<&str>) -> bool {
    let haystack = format!(
        "{} {}",
        name.to_ascii_lowercase(),
        executable_path.unwrap_or_default().to_ascii_lowercase()
    );
    contains_any(
        &haystack,
        &[
            "hd-player",
            "bluestacks",
            "bstk",
            "msi app player",
            "msiappplayer",
            "wsl.exe",
            "wslhost",
            "vmmem",
            "vmmemwsl",
        ],
    )
}

fn is_allowed_priority_game(active_game: &GamerActiveGame) -> bool {
    let haystack = format!(
        "{} {} {} {}",
        active_game.process_name.clone().unwrap_or_default(),
        active_game.display_name.clone().unwrap_or_default(),
        active_game.executable_path.clone().unwrap_or_default(),
        active_game.window_title.clone().unwrap_or_default()
    )
    .to_ascii_lowercase();
    contains_any(&haystack, game_patterns())
}

fn critical_process_names() -> &'static [&'static str] {
    &[
        "system",
        "idle",
        "registry",
        "smss",
        "csrss",
        "wininit",
        "services",
        "lsass",
        "winlogon",
        "dwm",
        "explorer",
        "svchost",
        "fontdrvhost",
        "sihost",
        "taskhostw",
        "audiodg",
        "securityhealthservice",
        "searchindexer",
    ]
}

fn game_patterns() -> &'static [&'static str] {
    &[
        "fate trigger",
        "fatetrigger",
        "fate_trigger",
        "fate-trigger",
        "steamapps\\common\\fate trigger",
        "steamapps\\common\\fatetrigger",
        "fatetrigger-win64-shipping",
        "fate_trigger-win64-shipping",
        "unrealengine",
        "unreal engine",
        "ue5",
        "win64-shipping",
        "hd-player",
        "bluestacks",
        "bstk",
        "wsl.exe",
        "wslhost",
        "vmmem",
        "vmmemwsl",
        "msi app player",
        "msiappplayer",
        "valorant",
        "leagueclient",
        "r5apex",
        "fortniteclient",
        "cs2",
        "dota2",
        "destiny2",
        "eldenring",
        "cyberpunk2077",
        "gta5",
        "minecraft",
        "robloxplayerbeta",
        "fivem",
        "overwatch",
        "rocketleague",
        "forza",
        "witcher3",
        "starfield",
    ]
}

fn launcher_patterns() -> &'static [&'static str] {
    &[
        "steam.exe",
        "steamwebhelper.exe",
        "epicgameslauncher",
        "epicwebhelper",
        "battle.net",
        "battlenet",
        "riotclientservices",
        "ubisoftconnect",
        "eadesktop",
        "goggalaxy",
        "xboxapp",
        "xboxpcapp",
        "playnite",
    ]
}

fn overlay_patterns() -> &'static [&'static str] {
    &[
        "discordoverlay",
        "discordhookhelper",
        "eosoverlayrenderer",
        "gamebar",
        "xboxgamebar",
        "gamebarftserver",
        "gamebarpresencewriter",
        "geforce experience",
        "nvidia share",
        "nvcontainer",
        "nvsphelper",
        "amdow",
        "radeonsoftware",
        "steamwebhelper",
        "overwolf",
        "razer",
        "razer synapse",
        "medal",
        "msiafterburner",
        "rtss",
    ]
}

fn steam_overlay_patterns() -> &'static [&'static str] {
    &["steamwebhelper", "gameoverlayui"]
}

fn xbox_overlay_patterns() -> &'static [&'static str] {
    &[
        "gamebar",
        "xboxgamebar",
        "gamebarftserver",
        "gamebarpresencewriter",
    ]
}

fn gpu_overlay_patterns() -> &'static [&'static str] {
    &[
        "geforce experience",
        "nvidia share",
        "nvcontainer",
        "nvsphelper",
        "amdow",
        "radeonsoftware",
    ]
}

fn communication_patterns() -> &'static [&'static str] {
    &["discord", "teams", "skype", "telegram", "whatsapp", "slack"]
}

fn browser_patterns() -> &'static [&'static str] {
    &["chrome", "msedge", "firefox", "brave", "opera", "vivaldi"]
}

fn cloud_patterns() -> &'static [&'static str] {
    &[
        "onedrive",
        "dropbox",
        "googledrivefs",
        "google drive",
        "icloud",
    ]
}

fn creative_patterns() -> &'static [&'static str] {
    &[
        "obs",
        "obs64",
        "obs32",
        "obs-studio",
        "photoshop",
        "illustrator",
        "premiere",
        "afterfx",
        "lightroom",
        "creative cloud",
    ]
}

fn background_patterns() -> &'static [&'static str] {
    &["spotify", "adobe", "updater", "update", "helper"]
}

fn fallback_raw_report() -> RawGamerReport {
    RawGamerReport {
        active_process: None,
        processes: Some(Vec::new()),
    }
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn value_or(value: Option<String>, fallback: &str) -> String {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn run_powershell(script: &str) -> Result<String, String> {
    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    let mut child = command
        .spawn()
        .map_err(|err| format!("Nao foi possivel iniciar PowerShell gamer: {err}"))?;
    let started_at = SystemTime::now();

    loop {
        if child
            .try_wait()
            .map_err(|err| format!("Falha ao aguardar PowerShell gamer: {err}"))?
            .is_some()
        {
            break;
        }

        let elapsed = SystemTime::now()
            .duration_since(started_at)
            .unwrap_or_default()
            .as_secs();
        if elapsed >= GAMER_COMMAND_TIMEOUT_SECONDS {
            let _ = child.kill();
            return Err("Tempo limite atingido na Gamer Engine.".to_string());
        }

        thread::sleep(Duration::from_millis(80));
    }

    let output = child
        .wait_with_output()
        .map_err(|err| format!("Nao foi possivel ler saida do PowerShell gamer: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("PowerShell gamer retornou erro: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        Err("PowerShell gamer nao retornou dados.".to_string())
    } else {
        Ok(stdout)
    }
}

fn now_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    seconds.to_string()
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

const POWERSHELL_GAMER_PROCESS_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class HermesForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
} catch {}

$interesting = @(
  'discord','spotify','onedrive','teams','telegram','whatsapp','slack',
  'steam','steamwebhelper','epicgameslauncher','battle.net','battlenet',
  'epicwebhelper','eosoverlayrenderer','riotclientservices','ubisoftconnect','eadesktop','goggalaxy',
  'chrome','msedge','firefox','brave','opera','vivaldi',
  'gamebar','xboxgamebar','gamebarftserver','gamebarpresencewriter','gameoverlayui','nvidia share','geforce experience',
  'nvcontainer','nvsphelper','amdow','radeonsoftware','overwolf','razer','medal','msiafterburner','rtss',
  'obs','obs64','obs32','obs-studio','photoshop','illustrator','premiere','afterfx','lightroom',
  'fate trigger','fatetrigger','fate_trigger','fate-trigger','fatetrigger-win64-shipping',
  'unrealengine','unreal engine','ue5','win64-shipping','hd-player','bluestacks','bstk','wsl','wslhost','vmmem','vmmemwsl',
  'valorant','leagueclient','r5apex','fortniteclient','cs2','dota2',
  'destiny2','eldenring','cyberpunk2077','gta5','minecraft','robloxplayerbeta',
  'fivem','overwatch','rocketleague','forza','witcher3','starfield'
)

$procById = @{}
Get-Process | ForEach-Object { $procById[[int]$_.Id] = $_ }
$allProcesses = @(Get-CimInstance Win32_Process)

function Convert-HermesProcess($item) {
  $proc = $procById[[int]$item.ProcessId]
  $path = [string]$item.ExecutablePath
  $cmd = [string]$item.CommandLine
  $title = if ($null -ne $proc) { [string]$proc.MainWindowTitle } else { '' }
  $memoryMb = if ($null -ne $proc) { [math]::Round($proc.WorkingSet64 / 1MB) } else { 0 }
  [pscustomobject]@{
    pid = [int]$item.ProcessId
    name = [string]$item.Name
    executablePath = if ([string]::IsNullOrWhiteSpace($path)) { $null } else { $path }
    commandLine = if ([string]::IsNullOrWhiteSpace($cmd)) { $null } else { $cmd }
    memoryMb = [int64]$memoryMb
    mainWindowTitle = $title
  }
}

$foregroundPid = 0
try {
  $foregroundHandle = [HermesForegroundWindow]::GetForegroundWindow()
  [uint32]$foregroundPidValue = 0
  [HermesForegroundWindow]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundPidValue) | Out-Null
  $foregroundPid = [int]$foregroundPidValue
} catch {
  $foregroundPid = 0
}

$activeProcess = $null
if ($foregroundPid -gt 0) {
  $activeItem = $allProcesses | Where-Object { [int]$_.ProcessId -eq $foregroundPid } | Select-Object -First 1
  if ($null -ne $activeItem) {
    $activeProcess = Convert-HermesProcess $activeItem
  }
}

$items = @($allProcesses | ForEach-Object {
  $name = [string]$_.Name
  $path = [string]$_.ExecutablePath
  $cmd = [string]$_.CommandLine
  $proc = $procById[[int]$_.ProcessId]
  $title = if ($null -ne $proc) { [string]$proc.MainWindowTitle } else { '' }
  $memoryMb = if ($null -ne $proc) { [math]::Round($proc.WorkingSet64 / 1MB) } else { 0 }
  $haystack = "$name $path $cmd $title".ToLowerInvariant()
  $matched = $false
  foreach ($needle in $interesting) {
    if ($haystack.Contains($needle)) { $matched = $true; break }
  }
  if ($matched -or $memoryMb -ge 250 -or $title.Length -gt 0) {
    Convert-HermesProcess $_
  }
})

[pscustomobject]@{
  activeProcess = $activeProcess
  processes = @($items | Sort-Object -Property memoryMb -Descending | Select-Object -First 80)
} | ConvertTo-Json -Depth 5 -Compress
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gamer_performance_actions_do_not_include_visual_tweaks() {
        let blocked = [
            "disable-transparency",
            "disable-window-animations",
            "disable-visual-shadows",
            "set-visual-effects-custom",
        ];

        for action in blocked {
            assert!(
                !GAMER_PERFORMANCE_ACTION_IDS.contains(&action),
                "Gamer Engine must keep visual action {action} opt-in and separate"
            );
        }
    }

    #[test]
    fn gamer_exceptions_protect_streaming_and_virtualization() {
        assert!(is_streaming_exception_process("obs64.exe", None));
        assert!(is_emulator_exception_process(
            "HD-Player.exe",
            Some("C:\\Program Files\\BlueStacks_nxt\\HD-Player.exe")
        ));
        assert!(is_emulator_exception_process("vmmemWSL", None));
        assert!(!is_streaming_exception_process("chrome.exe", None));
    }

    #[test]
    fn gamer_priority_is_scoped_to_detected_games() {
        let fate = GamerActiveGame {
            detected: true,
            confidence: GamerDetectionConfidence::High,
            pid: Some(123),
            process_name: Some("FateTrigger-Win64-Shipping.exe".to_string()),
            display_name: Some("Fate Trigger".to_string()),
            executable_path: Some(
                "C:\\SteamLibrary\\steamapps\\common\\FateTrigger\\FateTrigger-Win64-Shipping.exe"
                    .to_string(),
            ),
            window_title: Some("Fate Trigger".to_string()),
            matched_profile: None,
            recommended_plan: None,
            requires_manual_selection: false,
            message: "Detectado".to_string(),
        };
        let notepad = GamerActiveGame {
            process_name: Some("notepad.exe".to_string()),
            display_name: Some("Notepad".to_string()),
            executable_path: Some("C:\\Windows\\System32\\notepad.exe".to_string()),
            window_title: Some("Untitled - Notepad".to_string()),
            ..fate.clone()
        };

        assert!(is_allowed_priority_game(&fate));
        assert!(!is_allowed_priority_game(&notepad));
    }
}
