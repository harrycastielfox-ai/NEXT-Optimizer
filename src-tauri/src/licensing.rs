use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

use crate::{license_policy::{validate_authorization, AuthorizationEvidence}, license_transport};

static SESSION_PATH: OnceLock<PathBuf> = OnceLock::new();
static SESSION: Mutex<LicenseSession> = Mutex::new(LicenseSession {
    loaded: false,
    token: None,
    authorization: None,
});

struct CachedAuthorization {
    fingerprint: String,
    deadline: Instant,
}

struct LicenseSession {
    loaded: bool,
    token: Option<String>,
    authorization: Option<CachedAuthorization>,
}

pub(crate) fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    let directory = app.path().app_local_data_dir().map_err(|_| "Pasta de licenciamento indisponivel.")?;
    SESSION_PATH.set(directory.join("license-session-v2.dpapi"))
        .map_err(|_| "Licenciamento ja inicializado.".to_string())
}

fn session_path() -> Result<&'static PathBuf, String> {
    SESSION_PATH.get().ok_or_else(|| "Licenciamento nativo indisponivel.".to_string())
}

fn valid_token(token: &str) -> bool {
    token.len() == 64 && token.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn locked_session() -> Result<MutexGuard<'static, LicenseSession>, String> {
    SESSION.lock().map_err(|_| "Estado de licenciamento indisponivel.".into())
}

fn load_token(session: &mut LicenseSession) -> Result<String, String> {
    if !session.loaded {
        let path = session_path()?;
        match std::fs::read(path) {
            Ok(encrypted) => {
                let plaintext = license_transport::protect(&encrypted, true)?;
                let token = String::from_utf8(plaintext).map_err(|_| "Credencial local invalida.")?;
                if !valid_token(&token) { return Err("Credencial local invalida. Ative novamente a licenca.".into()); }
                session.token = Some(token);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Nao foi possivel ler a sessao local. Ative novamente a licenca.".into()),
        }
        session.loaded = true;
    }
    session.token.clone().ok_or_else(|| "LICENSE_SESSION_REQUIRED: ative sua licenca neste computador para habilitar alteracoes reais.".into())
}

fn persist_token(token: &str) -> Result<(), String> {
    let path = session_path()?;
    let parent = path.parent().ok_or("Pasta de licenciamento invalida.")?;
    let encrypted = license_transport::protect(token.as_bytes(), false)?;
    std::fs::create_dir_all(parent).map_err(|_| "Nao foi possivel criar a pasta da sessao.")?;
    let temporary = path.with_extension("dpapi.tmp");
    std::fs::write(&temporary, encrypted).map_err(|_| "Nao foi possivel salvar a sessao protegida.")?;
    std::fs::rename(&temporary, path).map_err(|_| "Nao foi possivel concluir a gravacao da sessao protegida.".into())
}

fn response_lifetime(response: &Value, fingerprint: &str) -> Result<u64, String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Relogio do Windows invalido.")?.as_secs();
    let evidence = AuthorizationEvidence {
        ok: response["ok"].as_bool().unwrap_or(false),
        access: response["access"].as_str().unwrap_or(""),
        entitlement_status: response["entitlement"]["status"].as_str().unwrap_or(""),
        device_fingerprint: response["deviceFingerprint"].as_str().unwrap_or(""),
        ttl_seconds: response["authorizationTtlSeconds"].as_u64().unwrap_or(0),
        expires_at_unix: response["authorizationExpiresAtUnix"].as_u64().unwrap_or(0),
    };
    validate_authorization(&evidence, fingerprint, now).map_err(str::to_owned)
}

fn cache_authorization(session: &mut LicenseSession, response: &Value, fingerprint: &str) -> Result<(), String> {
    let lifetime = response_lifetime(response, fingerprint)?;
    session.authorization = Some(CachedAuthorization {
        fingerprint: fingerprint.to_owned(),
        deadline: Instant::now() + Duration::from_secs(lifetime),
    });
    Ok(())
}

fn public_response(response: &Value) -> Value {
    // Explicit allowlist prevents a future server field leaking credentials to JS.
    let mut result = serde_json::Map::new();
    for field in ["ok", "account", "access", "accessReason", "entitlement", "deviceLabel"] {
        if let Some(value) = response.get(field) { result.insert(field.to_string(), value.clone()); }
    }
    if let Some(expires_at) = response["session"].get("expiresAt") {
        result.insert("session".into(), json!({"expiresAt": expires_at}));
    }
    Value::Object(result)
}

fn verify_online(session: &mut LicenseSession, identity: &NexDeviceIdentity) -> Result<Value, String> {
    // A failed refresh always invalidates the previous grant, including network errors.
    session.authorization = None;
    let token = load_token(session)?;
    license_transport::post(&json!({"action": "verify", "sessionToken": token, "device": identity}))
}

/// Called inside the Rust engine before any new real action. Renderer claims
/// and stored UI state cannot grant access. Recovery operations are exempt.
pub(crate) fn require_real_license(dry_run: bool) -> Result<(), String> {
    if dry_run { return Ok(()); }
    let identity = nex_device_identity()?;
    let mut session = locked_session()?;
    if session.authorization.as_ref().is_some_and(|authorization| {
        authorization.fingerprint == identity.fingerprint && Instant::now() < authorization.deadline
    }) { return Ok(()); }
    let response = verify_online(&mut session, &identity)?;
    cache_authorization(&mut session, &response, &identity.fingerprint)
}

#[tauri::command]
pub async fn nex_license_activate(email: String, code: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let email = email.trim().to_lowercase();
        let code = code.trim().to_uppercase();
        if email.len() > 254 || !email.contains('@') || code.is_empty() || code.len() > 128 {
            return Err("Informe um email e um codigo de ativacao validos.".into());
        }
        let identity = nex_device_identity()?;
        let mut session = locked_session()?;
        session.authorization = None;
        let response = license_transport::post(&json!({"action": "activate", "email": email, "code": code, "device": identity}))?;
        let token = response["session"]["token"].as_str().filter(|token| valid_token(token))
            .ok_or("LICENSE_PROTOCOL_ERROR: servico nao emitiu sessao segura. Publique a atualizacao de licenciamento antes de ativar.")?;
        response_lifetime(&response, &identity.fingerprint)?;
        persist_token(token)?;
        session.token = Some(token.to_owned());
        session.loaded = true;
        cache_authorization(&mut session, &response, &identity.fingerprint)?;
        Ok(public_response(&response))
    }).await.map_err(|_| "Falha ao ativar licenca em segundo plano.".to_string())?
}

#[tauri::command]
pub async fn nex_license_verify() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let identity = nex_device_identity()?;
        let mut session = locked_session()?;
        let response = verify_online(&mut session, &identity)?;
        if response["access"].as_str() == Some("allowed") {
            cache_authorization(&mut session, &response, &identity.fingerprint)?;
        }
        Ok(public_response(&response))
    }).await.map_err(|_| "Falha ao verificar licenca em segundo plano.".to_string())?
}

#[tauri::command]
pub async fn nex_license_sign_out() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = locked_session()?;
        session.authorization = None;
        let token = load_token(&mut session).ok();
        session.token = None;
        session.loaded = true;
        match std::fs::remove_file(session_path()?) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Sessao encerrada em memoria, mas nao foi possivel apagar a credencial local protegida.".into()),
        }
        if let (Some(token), Ok(identity)) = (token, nex_device_identity()) {
            // Local logout always completes even when the server is unavailable.
            let _ = license_transport::post(&json!({"action": "revoke", "sessionToken": token, "device": identity}));
        }
        Ok(())
    }).await.map_err(|_| "Falha ao encerrar sessao em segundo plano.".to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NexDeviceIdentity {
    fingerprint: String,
    label: String,
    source: String,
}

#[cfg(windows)]
fn read_windows_machine_guid() -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("reg.exe")
        .creation_flags(0x08000000)
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .map_err(|error| format!("Nao foi possivel consultar a identidade do Windows: {error}"))?;

    if !output.status.success() {
        return Err("O Windows nao forneceu uma identidade valida para este computador.".into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .find_map(|line| {
            let (_, value) = line.split_once("REG_SZ")?;
            let value = value.trim();
            (!value.is_empty()).then(|| value.to_owned())
        })
        .ok_or_else(|| "A identidade deste computador nao foi encontrada no Windows.".into())
}

#[tauri::command]
pub fn nex_device_identity() -> Result<NexDeviceIdentity, String> {
    #[cfg(windows)]
    {
        let machine_guid = read_windows_machine_guid()?;
        let mut hasher = Sha256::new();
        hasher.update(b"nex-optimizer-device-v1:");
        hasher.update(machine_guid.trim().to_ascii_lowercase().as_bytes());
        let fingerprint = format!("{:x}", hasher.finalize());
        let label = std::env::var("COMPUTERNAME")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "PC Windows".to_string());

        return Ok(NexDeviceIdentity {
            fingerprint,
            label,
            source: "windows-machine-guid-sha256".to_string(),
        });
    }

    #[cfg(not(windows))]
    Err("A vinculacao de dispositivo do NEXT esta disponivel somente no Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_receives_no_token_or_native_authorization_claims() {
        let output = public_response(&json!({
            "ok": true, "access": "allowed", "account": {"email": "test@example.com"},
            "session": {"token": "secret", "expiresAt": "2026-10-01T00:00:00Z"},
            "authorizationTtlSeconds": 30, "deviceFingerprint": "secret-device", "futureToken": "secret"
        }));
        assert!(output["session"].get("token").is_none());
        assert!(output.get("futureToken").is_none());
        assert!(output.get("authorizationTtlSeconds").is_none());
        assert_eq!(output["access"], "allowed");
    }

    #[test]
    fn local_storage_style_payload_cannot_grant_native_access() {
        assert!(response_lifetime(&json!({"access":"allowed", "entitlement":{"status":"active"}}), &"a".repeat(64)).is_err());
    }

    #[test]
    fn token_format_is_strict_and_bounded() {
        assert!(valid_token(&"a".repeat(64)));
        for token in [String::new(), "a".repeat(63), "a".repeat(65), "z".repeat(64)] {
            assert!(!valid_token(&token));
        }
    }
}
