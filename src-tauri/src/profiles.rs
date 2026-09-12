use crate::{
    advanced::{self, AdvancedApplyRequest},
    clean::{self, CleanApplyRequest},
    gamer::{self, GamerApplyRequest},
    performance::{self, PerformanceApplyActionResult, PerformanceApplyRequest},
    restore, safe_mode,
    startup::{self, StartupApplyAction, StartupApplyRequest},
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const MAX_PROFILE_EVENTS: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesCatalog {
    pub generated_at: String,
    pub engine_version: String,
    pub read_only: bool,
    pub telemetry: bool,
    pub resident_process: bool,
    pub profiles: Vec<HermesProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesProfile {
    pub id: String,
    pub name: String,
    pub summary: String,
    pub risk: ProfileRisk,
    pub status: ProfileStatus,
    pub reversible: bool,
    pub requires_confirmation: bool,
    pub requires_extra_confirmation: bool,
    pub performance_action_ids: Vec<String>,
    pub clean_item_ids: Vec<String>,
    pub startup_action: Option<StartupApplyAction>,
    pub startup_impacts: Vec<startup::StartupImpact>,
    pub gamer_enabled: bool,
    pub advanced_action_ids: Vec<String>,
    pub expected_impact: Vec<String>,
    pub safeguards: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProfileRisk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileStatus {
    Ready,
    PreviewOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProfileApplyRequest {
    pub profile_id: String,
    pub confirmed: bool,
    pub dry_run: Option<bool>,
    pub extreme_confirmed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileApplyResult {
    pub generated_at: String,
    pub engine_version: String,
    pub profile_id: String,
    pub profile_name: String,
    pub dry_run: bool,
    pub snapshot_id: String,
    pub snapshot_ids: Vec<String>,
    pub rollback_available: bool,
    pub applied_actions: Vec<PerformanceApplyActionResult>,
    pub engine_results: Vec<ProfileEngineResult>,
    pub conflict_warnings: Vec<String>,
    pub recommended_profile_persisted: bool,
    pub profile_summary: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileEngineResult {
    pub engine: String,
    pub status: ProfileEngineStatus,
    pub snapshot_id: Option<String>,
    pub rollback_available: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProfileEngineStatus {
    DryRun,
    Applied,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileEvent {
    id: String,
    timestamp: String,
    profile_id: Option<String>,
    level: ProfileEventLevel,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum ProfileEventLevel {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProfileEventHistory {
    events: Vec<ProfileEvent>,
}

#[tauri::command]
pub fn profiles_list() -> ProfilesCatalog {
    ProfilesCatalog {
        generated_at: now_timestamp(),
        engine_version: "profiles-engine-v1".to_string(),
        read_only: true,
        telemetry: false,
        resident_process: false,
        profiles: profile_definitions(),
    }
}

#[tauri::command]
pub async fn profiles_apply(
    app: AppHandle,
    request: Option<ProfileApplyRequest>,
) -> Result<ProfileApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || profiles_apply_blocking(app, request))
        .await
        .map_err(|err| format!("Falha ao aplicar perfil em segundo plano: {err}"))?
}

fn profiles_apply_blocking(
    app: AppHandle,
    request: Option<ProfileApplyRequest>,
) -> Result<ProfileApplyResult, String> {
    let request = request.unwrap_or_default();
    let profile = profile_definitions()
        .into_iter()
        .find(|profile| profile.id == request.profile_id)
        .ok_or_else(|| format!("Perfil NEX não encontrado: {}", request.profile_id))?;
    let dry_run = safe_mode::force_dry_run(request.dry_run.unwrap_or(!request.confirmed));

    if !dry_run && !request.confirmed {
        return Err("Confirmação obrigatória antes de aplicar um perfil NEX.".to_string());
    }

    if !dry_run && profile.requires_extra_confirmation && request.extreme_confirmed != Some(true) {
        return Err("Perfil Extremo exige confirmacao extra antes da aplicacao real.".to_string());
    }
    crate::licensing::require_real_license(dry_run)?;

    append_profile_event(
        &app,
        ProfileEventLevel::Info,
        Some(profile.id.clone()),
        if dry_run {
            "DRY-RUN | Perfil NEX iniciado em dry-run."
        } else {
            "Aplicação real de perfil NEX iniciada após confirmação."
        },
    )?;

    let mut engine_results = Vec::new();
    let mut snapshot_ids = Vec::new();
    let mut applied_actions = Vec::new();
    let mut failed = false;
    let conflict_warnings = validate_profile_conflicts(&profile);
    if !dry_run && !conflict_warnings.is_empty() {
        // validate_profile_conflicts() itself says these warnings mean the profile "deve ser
        // bloqueada em revisao" - it was only ever returned for display, never enforced. Make
        // that literal: refuse to apply for real while the profile definition has a hard
        // conflict (e.g. High Performance + Power Saver bundled together).
        return Err(format!(
            "Perfil bloqueado por conflito de configuracao: {}",
            conflict_warnings.join(" ")
        ));
    }
    let recommended_profile_persisted =
        persist_recommended_profile(&app, &profile, dry_run).is_ok();

    run_profile_performance(
        &app,
        &request,
        &profile,
        dry_run,
        &mut engine_results,
        &mut snapshot_ids,
        &mut applied_actions,
    );
    failed = failed || has_profile_failure(&engine_results);

    if !failed {
        run_profile_advanced(
            &app,
            &request,
            &profile,
            dry_run,
            &mut engine_results,
            &mut snapshot_ids,
        );
        failed = failed || has_profile_failure(&engine_results);
    }

    if !failed {
        run_profile_startup(
            &app,
            &request,
            &profile,
            dry_run,
            &mut engine_results,
            &mut snapshot_ids,
        );
        failed = failed || has_profile_failure(&engine_results);
    }

    if !failed {
        run_profile_clean(
            &app,
            &request,
            &profile,
            dry_run,
            &mut engine_results,
            &mut snapshot_ids,
        );
        failed = failed || has_profile_failure(&engine_results);
    }

    if !failed {
        run_profile_gamer(
            &app,
            &request,
            &profile,
            dry_run,
            &mut engine_results,
            &mut snapshot_ids,
        );
        failed = failed || has_profile_failure(&engine_results);
    }

    if failed && !dry_run {
        rollback_profile_snapshots(&app, &profile, &snapshot_ids)?;
    }

    let message = if failed {
        "Perfil interrompido por falha em uma engine. Rollback automatico foi tentado para snapshots ja criados.".to_string()
    } else if dry_run {
        format!(
            "{} — perfil validado pelas engines configuradas, com snapshots e rollback preparados quando aplicavel. {}",
            safe_mode::mode_prefix(dry_run),
            if safe_mode::is_enabled() { safe_mode::notice() } else { "" }
        )
    } else {
        "Perfil aplicado orquestrando engines NEX com snapshot, log e rollback por engine."
            .to_string()
    };

    append_profile_event(
        &app,
        if failed {
            ProfileEventLevel::Error
        } else {
            ProfileEventLevel::Info
        },
        Some(profile.id.clone()),
        &message,
    )?;

    Ok(ProfileApplyResult {
        generated_at: now_timestamp(),
        engine_version: "profiles-engine-v1".to_string(),
        profile_id: profile.id.clone(),
        profile_name: profile.name.clone(),
        dry_run,
        snapshot_id: snapshot_ids
            .first()
            .cloned()
            .unwrap_or_else(|| "sem-snapshot".to_string()),
        snapshot_ids,
        rollback_available: engine_results
            .iter()
            .any(|result| result.rollback_available),
        applied_actions,
        engine_results,
        conflict_warnings,
        recommended_profile_persisted,
        profile_summary: build_profile_summary(&profile),
        message,
    })
}

fn run_profile_performance(
    app: &AppHandle,
    request: &ProfileApplyRequest,
    profile: &HermesProfile,
    dry_run: bool,
    engine_results: &mut Vec<ProfileEngineResult>,
    snapshot_ids: &mut Vec<String>,
    applied_actions: &mut Vec<PerformanceApplyActionResult>,
) {
    if profile.performance_action_ids.is_empty() {
        engine_results.push(skipped_engine(
            "Performance Engine",
            "Sem acoes de performance neste perfil.",
        ));
        return;
    }

    match performance::performance_apply_controlled(
        app.clone(),
        Some(PerformanceApplyRequest {
            confirmed: request.confirmed,
            dry_run: Some(dry_run),
            action_ids: Some(profile.performance_action_ids.clone()),
            reason: Some(format!("Perfil NEX: {}", profile.name)),
        }),
    ) {
        Ok(result) => {
            snapshot_ids.push(result.snapshot_id.clone());
            applied_actions.extend(result.applied_actions.clone());
            engine_results.push(engine_result(
                "Performance Engine",
                status_from_dry_run(dry_run),
                Some(result.snapshot_id),
                result.rollback_available,
                result.message,
            ));
        }
        Err(error) => engine_results.push(failed_engine("Performance Engine", error)),
    }
}

fn run_profile_advanced(
    app: &AppHandle,
    request: &ProfileApplyRequest,
    profile: &HermesProfile,
    dry_run: bool,
    engine_results: &mut Vec<ProfileEngineResult>,
    snapshot_ids: &mut Vec<String>,
) {
    if profile.advanced_action_ids.is_empty() {
        engine_results.push(skipped_engine(
            "Advanced Engine",
            "Sem acoes avancadas neste perfil.",
        ));
        return;
    }

    match advanced::advanced_engine_apply_blocking(
        app.clone(),
        Some(AdvancedApplyRequest {
            confirmed: request.confirmed,
            dry_run: Some(dry_run),
            action_ids: Some(profile.advanced_action_ids.clone()),
            extreme_mode: Some(profile.id == "extremo" && request.extreme_confirmed == Some(true)),
        }),
        true,
    ) {
        Ok(result) => {
            snapshot_ids.push(result.snapshot_id.clone());
            engine_results.push(engine_result(
                "Advanced Engine",
                status_from_dry_run(dry_run),
                Some(result.snapshot_id),
                result.rollback_available,
                result.message,
            ));
        }
        Err(error) => {
            if is_skippable_engine_error(&error) {
                engine_results.push(skipped_engine("Advanced Engine", &error));
            } else {
                engine_results.push(failed_engine("Advanced Engine", error));
            }
        }
    }
}

fn run_profile_startup(
    app: &AppHandle,
    request: &ProfileApplyRequest,
    profile: &HermesProfile,
    dry_run: bool,
    engine_results: &mut Vec<ProfileEngineResult>,
    snapshot_ids: &mut Vec<String>,
) {
    let Some(action) = profile.startup_action.clone() else {
        engine_results.push(skipped_engine(
            "Startup Engine",
            "Sem controle de inicializacao neste perfil.",
        ));
        return;
    };
    if profile.startup_impacts.is_empty() {
        engine_results.push(skipped_engine(
            "Startup Engine",
            "Sem impactos selecionados para inicializacao.",
        ));
        return;
    }

    match startup::startup_engine_apply_blocking(
        app.clone(),
        Some(StartupApplyRequest {
            confirmed: request.confirmed,
            dry_run: Some(dry_run),
            action,
            item_ids: None,
            impacts: Some(profile.startup_impacts.clone()),
        }),
    ) {
        Ok(result) => {
            snapshot_ids.push(result.snapshot_id.clone());
            engine_results.push(engine_result(
                "Startup Engine",
                status_from_dry_run(dry_run),
                Some(result.snapshot_id),
                result.rollback_available,
                result.message,
            ));
        }
        Err(error) => {
            if is_skippable_engine_error(&error) {
                engine_results.push(skipped_engine("Startup Engine", &error));
            } else {
                engine_results.push(failed_engine("Startup Engine", error));
            }
        }
    }
}

fn run_profile_clean(
    app: &AppHandle,
    request: &ProfileApplyRequest,
    profile: &HermesProfile,
    dry_run: bool,
    engine_results: &mut Vec<ProfileEngineResult>,
    snapshot_ids: &mut Vec<String>,
) {
    if profile.clean_item_ids.is_empty() {
        engine_results.push(skipped_engine("Clean Engine", "Sem limpeza neste perfil."));
        return;
    }

    match clean::clean_engine_apply_blocking(
        app.clone(),
        Some(CleanApplyRequest {
            confirmed: request.confirmed,
            dry_run: Some(dry_run),
            item_ids: Some(profile.clean_item_ids.clone()),
        }),
        true,
    ) {
        Ok(result) => {
            snapshot_ids.push(result.snapshot_id.clone());
            engine_results.push(engine_result(
                "Clean Engine",
                status_from_dry_run(dry_run),
                Some(result.snapshot_id),
                result.rollback_available,
                result.message,
            ));
        }
        Err(error) => {
            if is_skippable_engine_error(&error) {
                engine_results.push(skipped_engine("Clean Engine", &error));
            } else {
                engine_results.push(failed_engine("Clean Engine", error));
            }
        }
    }
}

fn run_profile_gamer(
    app: &AppHandle,
    request: &ProfileApplyRequest,
    profile: &HermesProfile,
    dry_run: bool,
    engine_results: &mut Vec<ProfileEngineResult>,
    snapshot_ids: &mut Vec<String>,
) {
    if !profile.gamer_enabled {
        engine_results.push(skipped_engine(
            "Gamer Engine",
            "Modo Gamer nao faz parte deste perfil.",
        ));
        return;
    }

    match gamer::gamer_engine_apply_blocking(
        app.clone(),
        Some(GamerApplyRequest {
            confirmed: request.confirmed,
            dry_run: Some(dry_run),
            process_ids: None,
            include_performance_profile: Some(false),
            game_profile_id: None,
        }),
    ) {
        Ok(result) => {
            snapshot_ids.push(result.snapshot_id.clone());
            engine_results.push(engine_result(
                "Gamer Engine",
                status_from_dry_run(dry_run),
                Some(result.snapshot_id),
                result.rollback_available,
                result.message,
            ));
        }
        Err(error) => {
            if is_skippable_engine_error(&error) {
                engine_results.push(skipped_engine("Gamer Engine", &error));
            } else {
                engine_results.push(failed_engine("Gamer Engine", error));
            }
        }
    }
}

fn rollback_profile_snapshots(
    app: &AppHandle,
    profile: &HermesProfile,
    snapshot_ids: &[String],
) -> Result<(), String> {
    for snapshot_id in snapshot_ids.iter().rev() {
        let message =
            match restore::restore_apply_snapshot(app.clone(), snapshot_id.clone(), Some(false)) {
                Ok(result) => format!("Rollback de perfil em {}: {}", snapshot_id, result.message),
                Err(error) => format!("Rollback de perfil falhou em {}: {}", snapshot_id, error),
            };
        append_profile_event(
            app,
            ProfileEventLevel::Warning,
            Some(profile.id.clone()),
            &message,
        )?;
    }
    Ok(())
}

fn has_profile_failure(results: &[ProfileEngineResult]) -> bool {
    results
        .iter()
        .any(|result| result.status == ProfileEngineStatus::Failed)
}

fn validate_profile_conflicts(profile: &HermesProfile) -> Vec<String> {
    let mut warnings = Vec::new();
    let has_high_performance = profile
        .performance_action_ids
        .iter()
        .any(|item| item == "set-high-performance-power-plan");
    let has_power_saver = profile
        .performance_action_ids
        .iter()
        .any(|item| item == "set-power-saver-power-plan");

    if has_high_performance && has_power_saver {
        warnings.push(
            "Perfil contem Alto Desempenho e Economia ao mesmo tempo; aplicacao deve ser bloqueada em revisao."
                .to_string(),
        );
    }

    if profile.gamer_enabled && has_power_saver {
        warnings.push(
            "Perfil Gamer nao deve usar Economia de Energia como plano principal.".to_string(),
        );
    }

    if profile.requires_extra_confirmation && profile.risk != ProfileRisk::High {
        warnings
            .push("Confirmacao extra deve ficar reservada para perfil de alto risco.".to_string());
    }

    warnings
}

fn build_profile_summary(profile: &HermesProfile) -> String {
    format!(
        "{}: {} | performance={} clean={} startup={} gamer={} advanced={}",
        profile.name,
        profile.summary,
        profile.performance_action_ids.len(),
        profile.clean_item_ids.len(),
        if profile.startup_action.is_some() {
            "sim"
        } else {
            "nao"
        },
        if profile.gamer_enabled { "sim" } else { "nao" },
        profile.advanced_action_ids.len()
    )
}

fn persist_recommended_profile(
    app: &AppHandle,
    profile: &HermesProfile,
    dry_run: bool,
) -> Result<(), String> {
    let path = recommended_profile_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Nao foi possivel criar pasta de perfil recomendado: {err}"))?;
    }

    let payload = serde_json::json!({
        "generatedAt": now_timestamp(),
        "profileId": profile.id,
        "profileName": profile.name,
        "dryRun": dry_run,
        "summary": build_profile_summary(profile),
    });
    fs::write(
        &path,
        serde_json::to_string_pretty(&payload)
            .map_err(|err| format!("Nao foi possivel serializar perfil recomendado: {err}"))?,
    )
    .map_err(|err| format!("Nao foi possivel salvar perfil recomendado: {err}"))
}

fn recommended_profile_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Nao foi possivel localizar AppData do NEX: {err}"))?;
    dir.push("recommended_profile.json");
    Ok(dir)
}

fn status_from_dry_run(dry_run: bool) -> ProfileEngineStatus {
    if dry_run {
        ProfileEngineStatus::DryRun
    } else {
        ProfileEngineStatus::Applied
    }
}

fn engine_result(
    engine: &str,
    status: ProfileEngineStatus,
    snapshot_id: Option<String>,
    rollback_available: bool,
    message: String,
) -> ProfileEngineResult {
    ProfileEngineResult {
        engine: engine.to_string(),
        status,
        snapshot_id,
        rollback_available,
        message,
    }
}

fn skipped_engine(engine: &str, message: &str) -> ProfileEngineResult {
    engine_result(
        engine,
        ProfileEngineStatus::Skipped,
        None,
        false,
        message.to_string(),
    )
}

fn failed_engine(engine: &str, message: String) -> ProfileEngineResult {
    engine_result(engine, ProfileEngineStatus::Failed, None, false, message)
}

fn is_skippable_engine_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("nenhum item")
        || normalized.contains("nenhuma acao")
        || normalized.contains("fallback")
        || normalized.contains("indisponivel")
}

fn profile_definitions() -> Vec<HermesProfile> {
    vec![
        profile(
            "seguro",
            "Seguro",
            "Maxima estabilidade com plano equilibrado.",
            ProfileRisk::Low,
            false,
            vec!["set-balanced-power-plan"],
            vec![],
            None,
            vec![],
            false,
            vec!["list-power-plans"],
            vec![
                "Mantem o Windows em modo equilibrado.".to_string(),
                "Evita ajustes agressivos.".to_string(),
                "Apenas registra planos de energia disponiveis.".to_string(),
            ],
        ),
        profile(
            "trabalho",
            "Trabalho",
            "Equilibrio para produtividade diaria.",
            ProfileRisk::Low,
            false,
            vec!["set-balanced-power-plan"],
            vec!["temp", "cache"],
            None,
            vec![],
            false,
            vec!["flush-dns-cache"],
            vec![
                "Mantem ajustes visuais separados e opt-in.".to_string(),
                "Mantem energia equilibrada.".to_string(),
                "Limpa temporarios/cache seguros com quarentena.".to_string(),
            ],
        ),
        profile(
            "gamer",
            "Gamer",
            "Prioriza resposta e desempenho sob demanda.",
            ProfileRisk::Medium,
            false,
            vec!["set-high-performance-power-plan"],
            vec!["temp", "cache", "thumbnails"],
            Some(StartupApplyAction::Disable),
            vec![startup::StartupImpact::High],
            true,
            vec!["enable-game-mode", "disable-game-dvr", "flush-dns-cache"],
            vec![
                "Nao altera tema ou efeitos visuais automaticamente.".to_string(),
                "Ativa Alto Desempenho quando disponivel.".to_string(),
                "Sugere fechamento seguro de overlays/apps secundarios.".to_string(),
                "Desabilita inicializacao de alto impacto quando controlavel.".to_string(),
            ],
        ),
        profile(
            "economia",
            "Economia",
            "Reduz consumo e animacoes nao essenciais.",
            ProfileRisk::Low,
            false,
            vec!["set-power-saver-power-plan"],
            vec!["temp"],
            Some(StartupApplyAction::Disable),
            vec![startup::StartupImpact::High],
            false,
            vec!["disable-game-dvr", "flush-dns-cache"],
            vec![
                "Nao altera tema ou efeitos visuais automaticamente.".to_string(),
                "Ativa Economia de Energia quando disponivel.".to_string(),
                "Reduz inicializacao pesada quando seguro.".to_string(),
            ],
        ),
        profile(
            "extremo",
            "Extremo",
            "Desempenho maximo com confirmacao extra.",
            ProfileRisk::High,
            true,
            vec!["set-high-performance-power-plan"],
            vec![
                "temp",
                "cache",
                "logs",
                "thumbnails",
                "windows-update-cache",
            ],
            Some(StartupApplyAction::Disable),
            vec![startup::StartupImpact::High, startup::StartupImpact::Medium],
            true,
            vec![
                "enable-game-mode",
                "disable-game-dvr",
                "disable-startup-delay",
                "flush-dns-cache",
                "list-power-plans",
            ],
            vec![
                "Aplica apenas ajustes nao visuais desta fase.".to_string(),
                "Exige confirmacao extra antes da aplicacao real.".to_string(),
                "Usa Clean, Startup, Gamer e Advanced em modo allowlist.".to_string(),
            ],
        ),
    ]
}

fn profile(
    id: &str,
    name: &str,
    summary: &str,
    risk: ProfileRisk,
    requires_extra_confirmation: bool,
    performance_action_ids: Vec<&str>,
    clean_item_ids: Vec<&str>,
    startup_action: Option<StartupApplyAction>,
    startup_impacts: Vec<startup::StartupImpact>,
    gamer_enabled: bool,
    advanced_action_ids: Vec<&str>,
    expected_impact: Vec<String>,
) -> HermesProfile {
    HermesProfile {
        id: id.to_string(),
        name: name.to_string(),
        summary: summary.to_string(),
        risk,
        status: ProfileStatus::Ready,
        reversible: true,
        requires_confirmation: true,
        requires_extra_confirmation,
        performance_action_ids: performance_action_ids
            .into_iter()
            .map(ToString::to_string)
            .collect(),
        clean_item_ids: clean_item_ids
            .into_iter()
            .map(ToString::to_string)
            .collect(),
        startup_action,
        startup_impacts,
        gamer_enabled,
        advanced_action_ids: advanced_action_ids
            .into_iter()
            .map(ToString::to_string)
            .collect(),
        expected_impact,
        safeguards: vec![
            "Snapshot obrigatorio antes de aplicar.".to_string(),
            "Log local obrigatorio.".to_string(),
            "Rollback pelo Restore Engine.".to_string(),
            "Sem telemetria ou processo residente.".to_string(),
        ],
    }
}

fn append_profile_event(
    app: &AppHandle,
    level: ProfileEventLevel,
    profile_id: Option<String>,
    message: &str,
) -> Result<(), String> {
    let path = profile_events_path(app)?;
    let mut history = read_profile_event_history(&path);
    history.events.insert(
        0,
        ProfileEvent {
            id: format!("profile-event-{}-{}", now_timestamp(), now_nanos()),
            timestamp: now_timestamp(),
            profile_id,
            level,
            message: message.to_string(),
        },
    );
    history.events.truncate(MAX_PROFILE_EVENTS);
    write_profile_event_history(&path, &history)
}

fn profile_events_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Nao foi possivel localizar AppData: {err}"))?;
    dir.push("history");
    fs::create_dir_all(&dir)
        .map_err(|err| format!("Nao foi possivel criar historico de perfis: {err}"))?;
    dir.push("profile_events.json");
    Ok(dir)
}

fn read_profile_event_history(path: &PathBuf) -> ProfileEventHistory {
    let Ok(contents) = fs::read_to_string(path) else {
        return ProfileEventHistory::default();
    };
    serde_json::from_str(&contents).unwrap_or_default()
}

fn write_profile_event_history(
    path: &PathBuf,
    history: &ProfileEventHistory,
) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(history)
        .map_err(|err| format!("Nao foi possivel serializar logs de perfis: {err}"))?;
    fs::write(path, contents)
        .map_err(|err| format!("Nao foi possivel gravar logs de perfis: {err}"))
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

#[cfg(test)]
mod tests {
    use super::*;

    const VISUAL_ACTIONS: &[&str] = &[
        "disable-transparency",
        "disable-window-animations",
        "disable-visual-shadows",
        "set-visual-effects-custom",
    ];

    #[test]
    fn gamer_economia_extremo_profiles_do_not_embed_visual_actions() {
        let profiles = profile_definitions();

        for profile_id in ["gamer", "economia", "extremo"] {
            let profile = profiles
                .iter()
                .find(|item| item.id == profile_id)
                .expect("profile must exist");

            for action in VISUAL_ACTIONS {
                assert!(
                    !profile
                        .performance_action_ids
                        .iter()
                        .any(|item| item == action),
                    "{profile_id} must not embed visual performance action {action}"
                );
                assert!(
                    !profile
                        .advanced_action_ids
                        .iter()
                        .any(|item| item == action),
                    "{profile_id} must not embed visual advanced action {action}"
                );
            }
        }
    }

    #[test]
    fn profile_conflict_validation_flags_incompatible_energy() {
        let mut profile = profile_definitions()
            .into_iter()
            .find(|item| item.id == "gamer")
            .expect("gamer profile");
        assert!(validate_profile_conflicts(&profile).is_empty());

        profile
            .performance_action_ids
            .push("set-power-saver-power-plan".to_string());
        let warnings = validate_profile_conflicts(&profile);
        assert!(warnings
            .iter()
            .any(|item| item.contains("Economia de Energia")));
    }
}
