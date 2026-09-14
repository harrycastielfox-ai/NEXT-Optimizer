//! Pure authorization policy, independently testable without a Tauri app,
//! network connection, registry reads or optimization engines.

pub(crate) const MAX_AUTHORIZATION_SECONDS: u64 = 30;

pub(crate) struct AuthorizationEvidence<'a> {
    pub ok: bool,
    pub access: &'a str,
    pub entitlement_status: &'a str,
    pub device_fingerprint: &'a str,
    pub ttl_seconds: u64,
    pub expires_at_unix: u64,
}

// Only the native HTTPS client may supply evidence. IPC accepts email/code,
// never authorization claims, device fingerprints, tokens or expiry values.
pub(crate) fn validate_authorization(
    evidence: &AuthorizationEvidence<'_>,
    native_fingerprint: &str,
    now_unix: u64,
) -> Result<u64, &'static str> {
    if !evidence.ok || evidence.access != "allowed" || evidence.entitlement_status != "active" {
        return Err("LICENSE_REQUIRED: uma licenca ativa e validada online e obrigatoria para novas alteracoes reais.");
    }
    if native_fingerprint.len() != 64 || evidence.device_fingerprint != native_fingerprint {
        return Err("LICENSE_DEVICE_MISMATCH: a licenca nao pertence a este computador.");
    }
    if evidence.ttl_seconds == 0 || evidence.ttl_seconds > MAX_AUTHORIZATION_SECONDS {
        return Err("LICENSE_PROTOCOL_ERROR: autorizacao ausente ou com prazo invalido. Atualize o servico de licenciamento.");
    }
    let remaining = evidence.expires_at_unix.saturating_sub(now_unix);
    if remaining == 0 || remaining > MAX_AUTHORIZATION_SECONDS {
        return Err("LICENSE_EXPIRED: autorizacao expirada ou relogio incorreto. Verifique a data/hora e valide a licenca online.");
    }
    Ok(remaining.min(evidence.ttl_seconds))
}

#[cfg(test)]
mod tests {
    use super::*;
    const FINGERPRINT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    fn active() -> AuthorizationEvidence<'static> {
        AuthorizationEvidence {
            ok: true, access: "allowed", entitlement_status: "active",
            device_fingerprint: FINGERPRINT, ttl_seconds: 30, expires_at_unix: 1030,
        }
    }
    #[test]
    fn valid_online_evidence_gets_only_the_remaining_lifetime() {
        assert_eq!(validate_authorization(&active(), FINGERPRINT, 1010), Ok(20));
    }
    #[test]
    fn revoked_and_expired_entitlements_are_denied() {
        for status in ["revoked", "expired", "", "pending"] {
            let mut evidence = active();
            evidence.entitlement_status = status;
            assert!(validate_authorization(&evidence, FINGERPRINT, 1000).is_err());
        }
    }
    #[test]
    fn denied_access_is_not_overridden_by_active_entitlement() {
        let mut evidence = active();
        evidence.access = "device_mismatch";
        assert!(validate_authorization(&evidence, FINGERPRINT, 1000).is_err());
        evidence.access = "allowed";
        evidence.ok = false;
        assert!(validate_authorization(&evidence, FINGERPRINT, 1000).is_err());
    }
    #[test]
    fn expiry_boundary_and_long_lived_claims_fail_closed() {
        assert!(validate_authorization(&active(), FINGERPRINT, 1030).is_err());
        assert!(validate_authorization(&active(), FINGERPRINT, 1031).is_err());
        assert!(validate_authorization(&active(), FINGERPRINT, 999).is_err());
        for ttl in [0, 31, u64::MAX] {
            let mut evidence = active();
            evidence.ttl_seconds = ttl;
            assert!(validate_authorization(&evidence, FINGERPRINT, 1000).is_err());
        }
    }
    #[test]
    fn claims_for_another_device_cannot_authorize_this_machine() {
        let mut evidence = active();
        evidence.device_fingerprint = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        assert!(validate_authorization(&evidence, FINGERPRINT, 1000).is_err());
        assert!(validate_authorization(&active(), "", 1000).is_err());
    }
}
