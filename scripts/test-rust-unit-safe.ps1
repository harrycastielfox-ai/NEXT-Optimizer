$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")

# Explicit allowlist: these tests validate in-memory state, plans and command
# allowlists. Do not replace this with an unfiltered cargo test: some legacy
# restore/startup tests execute PowerShell and move files.
$tests = @(
  "advanced::tests::advanced_state_accepts_nullable_nested_windows_values",
  "advanced::tests::advanced_allowlist_accepts_only_supported_windows_theme_values",
  "advanced::tests::advanced_allowlist_scopes_graphics_preference_to_fate_trigger",
  "advanced::tests::advanced_allowlist_accepts_background_and_notification_gamer_targets",
  "advanced::tests::advanced_allowlist_accepts_safe_tcp_global_commands",
  "advanced::tests::advanced_allowlist_accepts_only_safe_power_settings",
  "advanced::tests::advanced_allowlist_accepts_only_timer_policy_probe",
  "advanced::tests::advanced_default_catalog_includes_defender_executable_exclusion",
  "advanced::tests::advanced_phase_two_catalog_includes_dark_mode_and_display_never",
  "advanced::tests::advanced_allowlist_accepts_only_windows_theme_refresh_command",
  "advanced::tests::advanced_defender_exclusion_accepts_only_nex_executables",
  "advanced::tests::advanced_allowlist_accepts_only_optional_services_as_demand_start",
  "clean::tests::clean_engine_supports_gamer_cache_items",
  "clean::tests::clean_engine_keeps_user_locations_protected",
  "clean::tests::clean_engine_marks_summary_items_as_scan_only",
  "gamer::tests::gamer_performance_actions_do_not_include_visual_tweaks",
  "gamer::tests::gamer_exceptions_protect_streaming_and_virtualization",
  "gamer::tests::gamer_priority_is_scoped_to_detected_games",
  "performance::tests::gamer_profile_snapshot_captures_visual_fx_setting",
  "performance::tests::economia_profile_snapshot_captures_visual_fx_setting",
  "performance::tests::extremo_profile_snapshot_captures_visual_fx_setting",
  "license_policy::tests::valid_online_evidence_gets_only_the_remaining_lifetime",
  "license_policy::tests::revoked_and_expired_entitlements_are_denied",
  "license_policy::tests::denied_access_is_not_overridden_by_active_entitlement",
  "license_policy::tests::expiry_boundary_and_long_lived_claims_fail_closed",
  "license_policy::tests::claims_for_another_device_cannot_authorize_this_machine",
  "licensing::tests::renderer_receives_no_token_or_native_authorization_claims",
  "licensing::tests::local_storage_style_payload_cannot_grant_native_access",
  "licensing::tests::token_format_is_strict_and_bounded",
  "restore::tests::renderer_cannot_supply_executable_rollback_manifest"
)

$previousMode = $env:HERMES_SAFE_TEST_MODE
$env:HERMES_SAFE_TEST_MODE = "true"
Push-Location $root
try {
  foreach ($test in $tests) {
    # Capture stdout only; cargo emits compiler diagnostics on stderr.
    $output = @(& cargo.exe test --locked --manifest-path src-tauri/Cargo.toml --lib $test -- --exact)
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0 -or ($output -join "`n") -notmatch 'test result: ok\. 1 passed;') {
      throw "Audited test failed or disappeared: $test (exit $exitCode)."
    }
  }
  Write-Host "NEXT: $($tests.Count) audited Rust unit tests passed."
} finally {
  Pop-Location
  $env:HERMES_SAFE_TEST_MODE = $previousMode
}
