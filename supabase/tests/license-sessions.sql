-- Synthetic data only; the dedicated CI database is destroyed with the job.
\set ON_ERROR_STOP on
begin;
insert into public.license_admin_keys (label, actor_email, key_hash)
values ('CI-only', 'operator@example.com', repeat('9',64));
set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;

do $$
declare
  v_code record;
  v_result jsonb;
  v_account uuid;
  v_expiry timestamptz;
  v_admin uuid;
  v_plain text;
  v_token text := repeat('a', 64);
  v_token2 text := repeat('b', 64);
  v_device text := repeat('c', 64);
  v_device2 text := repeat('d', 64);
begin
  -- Legacy APIs and new credential tables must be inaccessible to browser roles.
  assert not has_function_privilege('anon', 'public.nex_activate_license_session(text,text,text,text,text)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.nex_verify_license_session(text,text)', 'EXECUTE');
  assert not has_function_privilege('service_role', 'public.get_email_device_entitlement(text,text,text)', 'EXECUTE');
  assert not has_table_privilege('anon', 'public.license_sessions', 'SELECT');
  assert not has_table_privilege('authenticated', 'public.license_admin_keys', 'SELECT');
  assert (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.license_sessions'::regclass, 'public.license_rate_limits'::regclass, 'public.license_security_audit'::regclass));

  assert public.nex_consume_rate_limit(repeat('e',64), 2, 3600);
  assert public.nex_consume_rate_limit(repeat('e',64), 2, 3600);
  assert not public.nex_consume_rate_limit(repeat('e',64), 2, 3600);
  assert not public.nex_consume_rate_limit(repeat('e',64), 2, 3600);

  select * into v_code from public.admin_create_license_code('30_days', 'buyer@example.com', 'operator@example.com');
  v_plain := regexp_replace(v_code.plain_code, '[^A-Z0-9]', '', 'g');
  begin
    perform public.nex_activate_license_session('wrong@example.com', v_plain, v_device, 'CI PC', v_token);
    raise exception 'TEST_WRONG_EMAIL_ALLOWED';
  exception when raise_exception then
    if sqlerrm <> 'ACTIVATION_DENIED' then raise; end if;
  end;
  v_result := public.nex_activate_license_session('buyer@example.com', v_plain, v_device, 'CI PC', v_token);
  assert v_result->>'access' = 'allowed';
  assert (v_result->>'authorizationTtlSeconds')::int between 1 and 30;
  assert v_result->>'deviceFingerprint' = v_device;
  assert not (v_result->'session' ? 'token'); -- SQL only knows token hashes.
  v_account := (v_result->'account'->>'id')::uuid;
  v_expiry := (v_result->'entitlement'->>'expiresAt')::timestamptz;

  -- Retrying purchase proof restores a session but cannot add another month.
  v_result := public.nex_activate_license_session('buyer@example.com', v_plain, v_device, 'CI PC', v_token2);
  assert (v_result->'entitlement'->>'expiresAt')::timestamptz = v_expiry;
  begin
    perform public.nex_verify_license_session(v_token, v_device);
    raise exception 'TEST_OLD_SESSION_ALLOWED';
  exception when raise_exception then
    if sqlerrm <> 'LICENSE_SESSION_INVALID' then raise; end if;
  end;
  begin
    perform public.nex_verify_license_session(v_token2, v_device2);
    raise exception 'TEST_FOREIGN_DEVICE_ALLOWED';
  exception when raise_exception then
    if sqlerrm <> 'LICENSE_SESSION_INVALID' then raise; end if;
  end;

  update public.email_entitlements set expires_at = now() - interval '1 second' where account_id = v_account;
  assert public.nex_verify_license_session(v_token2, v_device)->>'access' = 'expired';
  update public.email_entitlements set expires_at = v_expiry where account_id = v_account;

  -- Admin key fixture is inserted by postgres below, never a real credential.
  select id into v_admin from public.license_admin_keys where label = 'CI-only';
  assert public.nex_admin_transfer_email_license(v_account, v_admin, v_plain, v_device2, 'CI second PC');
  begin
    perform public.nex_verify_license_session(v_token2, v_device);
    raise exception 'TEST_TRANSFER_OLD_SESSION_ALLOWED';
  exception when raise_exception then
    if sqlerrm <> 'LICENSE_SESSION_INVALID' then raise; end if;
  end;
  v_result := public.nex_activate_license_session('buyer@example.com', v_plain, v_device2, 'CI second PC', repeat('f',64));
  assert v_result->>'access' = 'allowed';
  assert public.nex_admin_revoke_email_license(v_account, v_admin);
  begin
    perform public.nex_activate_license_session('buyer@example.com', v_plain, v_device2, 'CI second PC', repeat('1',64));
    raise exception 'TEST_REVOKED_CODE_REACTIVATED';
  exception when raise_exception then
    if sqlerrm <> 'ACTIVATION_DENIED' then raise; end if;
  end;
  raise notice 'NEXT session SQL tests passed: grants/RLS, rate limit, activation, retry, expiry, device binding, transfer, revocation.';
end;
$$;
rollback;
