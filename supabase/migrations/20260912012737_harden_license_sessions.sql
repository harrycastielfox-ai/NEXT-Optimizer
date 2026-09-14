-- NEXT opaque sessions: only Edge Functions using service_role can access these APIs.
-- No public/anon/authenticated caller can supply an authoritative account or device.
create table public.license_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  account_id uuid not null references public.email_license_accounts(id) on delete cascade,
  device_hash text not null check (device_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index license_sessions_account_idx on public.license_sessions(account_id);
create index license_sessions_expiry_idx on public.license_sessions(expires_at);

create table public.license_rate_limits (
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_start bigint not null,
  hits integer not null default 1,
  expires_at timestamptz not null,
  primary key (key_hash, window_start)
);
create index license_rate_limits_expiry_idx on public.license_rate_limits(expires_at);

create table public.license_security_audit (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('activate', 'verify', 'revoke', 'admin')),
  outcome text not null check (outcome in ('allowed', 'denied', 'revoked', 'created', 'reviewed')),
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index license_security_audit_created_idx on public.license_security_audit(created_at);

alter table public.license_sessions enable row level security;
alter table public.license_rate_limits enable row level security;
alter table public.license_security_audit enable row level security;
revoke all on public.license_sessions, public.license_rate_limits, public.license_security_audit
  from public, anon, authenticated;
grant select, insert, update, delete on public.license_sessions, public.license_rate_limits,
  public.license_security_audit, public.email_license_accounts, public.email_entitlements,
  public.license_codes to service_role;
grant select on public.plans to service_role;
grant select, update on public.license_admin_keys to service_role;
grant select, insert on public.license_admin_audit to service_role;

-- Atomic UPSERT serializes competing Edge isolates. Increment saturates to avoid overflow.
-- It is its own RPC/transaction so rejected activation does not roll back the rate counter.
create function public.nex_consume_rate_limit(requested_key text, requested_limit integer, window_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_start bigint;
  v_hits integer;
begin
  if requested_key is null or requested_key !~ '^[a-f0-9]{64}$'
    or requested_limit not between 1 and 10000 or window_seconds not between 1 and 3600 then
    raise exception 'INVALID_RATE_LIMIT';
  end if;
  v_start := floor(extract(epoch from clock_timestamp()) / window_seconds)::bigint * window_seconds;
  insert into public.license_rate_limits as r (key_hash, window_start, expires_at)
  values (requested_key, v_start, to_timestamp(v_start + window_seconds + 86400))
  on conflict (key_hash, window_start) do update set hits = least(r.hits + 1, 10001)
  returning hits into v_hits;
  -- Bounded, opportunistic retention without a paid scheduler.
  if random() < 0.01 then
    delete from public.license_rate_limits where (key_hash, window_start) in (
      select key_hash, window_start from public.license_rate_limits where expires_at < now() limit 1000
    );
    delete from public.license_security_audit where id in (
      select id from public.license_security_audit where created_at < now() - interval '90 days' limit 1000
    );
    delete from public.license_sessions where token_hash in (
      select token_hash from public.license_sessions where expires_at < now() - interval '7 days' limit 1000
    );
  end if;
  return v_hits <= requested_limit;
end;
$$;

-- Verifying a known email and a self-reported fingerprint is never sufficient.
create function public.nex_verify_license_session(requested_token_hash text, device_fingerprint text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v record;
  v_reason text;
  v_access text;
  v_expiry bigint;
begin
  if requested_token_hash is null or requested_token_hash !~ '^[a-f0-9]{64}$'
    or device_fingerprint is null or device_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'LICENSE_SESSION_INVALID';
  end if;
  select s.expires_at as session_expires_at, a.id, a.email, a.device_label,
         e.plan_id, p.name as plan_name, e.status, e.starts_at, e.expires_at
    into v
  from public.license_sessions s
  join public.email_license_accounts a on a.id = s.account_id
  join public.email_entitlements e on e.account_id = a.id
  join public.plans p on p.id = e.plan_id
  where s.token_hash = requested_token_hash and s.revoked_at is null and s.expires_at > now()
    and s.device_hash = device_fingerprint and a.device_hash = device_fingerprint;
  if not found then raise exception 'LICENSE_SESSION_INVALID'; end if;
  v_reason := case when v.status = 'revoked' then 'REVOKED'
                   when v.expires_at <= now() then 'EXPIRED' else 'ALLOWED' end;
  v_access := case v_reason when 'REVOKED' then 'revoked' when 'EXPIRED' then 'expired' else 'allowed' end;
  v_expiry := floor(extract(epoch from least(now() + interval '30 seconds', v.expires_at, v.session_expires_at)))::bigint;
  return jsonb_build_object(
    'ok', true,
    'account', jsonb_build_object('id', v.id, 'email', v.email),
    'access', v_access, 'accessReason', v_reason,
    'deviceFingerprint', device_fingerprint,
    'authorizationExpiresAtUnix', case when v_access = 'allowed' then v_expiry else 0 end,
    'authorizationTtlSeconds', case when v_access = 'allowed' then greatest(0, least(30, v_expiry - ceil(extract(epoch from now()))::bigint)) else 0 end,
    'entitlement', jsonb_build_object('userId', v.id, 'planId', v.plan_id, 'planName', v.plan_name,
      'status', case when v_access = 'expired' then 'expired' else v.status end,
      'startsAt', v.starts_at, 'expiresAt', v.expires_at),
    'session', jsonb_build_object('expiresAt', v.session_expires_at)
  );
end;
$$;

-- Code redemption and session creation commit together. Retrying the original code on the
-- same bound device restores the credential without extending the entitlement twice.
create function public.nex_activate_license_session(
  requested_email text, redemption_code text, device_fingerprint text,
  requested_device_label text, requested_token_hash text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_email text := lower(trim(requested_email));
  v_email_hash text;
  v_code_hash text;
  v_code record;
  v_account public.email_license_accounts%rowtype;
  v_entitlement public.email_entitlements%rowtype;
  v_days integer;
  v_expiry timestamptz;
begin
  if v_email is null or length(v_email) > 320 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or device_fingerprint is null or device_fingerprint !~ '^[a-f0-9]{64}$'
    or requested_token_hash is null or requested_token_hash !~ '^[a-f0-9]{64}$'
    or redemption_code is null or redemption_code !~ '^[A-Z0-9]{8,100}$'
    or requested_device_label is null or length(requested_device_label) > 120 then
    raise exception 'ACTIVATION_DENIED';
  end if;
  v_email_hash := encode(extensions.digest(convert_to(v_email, 'UTF8'), 'sha256'), 'hex');
  v_code_hash := encode(extensions.digest(convert_to(redemption_code, 'UTF8'), 'sha256'), 'hex');
  select c.* into v_code from public.license_codes c where c.code_hash = v_code_hash for update;
  if not found or v_code.status = 'revoked' or v_code.assigned_email_hash is distinct from v_email_hash then
    raise exception 'ACTIVATION_DENIED';
  end if;

  if v_code.status = 'available' then
    if v_code.expires_at is not null and v_code.expires_at <= now() then raise exception 'ACTIVATION_DENIED'; end if;
    select duration_days into v_days from public.plans where id = v_code.plan_id and active;
    if not found then raise exception 'ACTIVATION_DENIED'; end if;
    insert into public.email_license_accounts (email, email_hash, device_hash, device_label, bound_at)
      values (v_email, v_email_hash, device_fingerprint, coalesce(nullif(requested_device_label, ''), 'PC Windows'), now())
      on conflict (email_hash) do nothing;
  end if;

  select * into v_account from public.email_license_accounts where email_hash = v_email_hash for update;
  if not found or v_account.device_hash is distinct from device_fingerprint then raise exception 'ACTIVATION_DENIED'; end if;
  select * into v_entitlement from public.email_entitlements where account_id = v_account.id for update;

  if v_code.status = 'available' then
    v_expiry := greatest(coalesce(v_entitlement.expires_at, now()), now()) + make_interval(days => v_days);
    insert into public.email_entitlements (account_id, plan_id, status, starts_at, expires_at, source_code_id)
      values (v_account.id, v_code.plan_id, 'active', now(), v_expiry, v_code.id)
      on conflict (account_id) do update set plan_id = excluded.plan_id, status = 'active',
        expires_at = excluded.expires_at, source_code_id = excluded.source_code_id, updated_at = now();
    update public.license_codes set status = 'redeemed', redeemed_email_account_id = v_account.id, redeemed_at = now()
      where id = v_code.id;
  else
    if v_code.redeemed_email_account_id is distinct from v_account.id or v_entitlement.status is distinct from 'active'
      or v_entitlement.expires_at is null or v_entitlement.expires_at <= now() then raise exception 'ACTIVATION_DENIED'; end if;
    v_expiry := v_entitlement.expires_at;
  end if;

  update public.license_sessions set revoked_at = now() where account_id = v_account.id and revoked_at is null;
  insert into public.license_sessions (token_hash, account_id, device_hash, expires_at)
    values (requested_token_hash, v_account.id, device_fingerprint, least(now() + interval '30 days', v_expiry));
  update public.email_license_accounts set last_seen_at = now(), updated_at = now() where id = v_account.id;
  insert into public.license_security_audit (action, outcome, actor_id) values ('activate', 'allowed', v_account.id);
  return public.nex_verify_license_session(requested_token_hash, device_fingerprint);
end;
$$;

create function public.nex_revoke_license_session(requested_token_hash text, device_fingerprint text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_account uuid;
begin
  update public.license_sessions set revoked_at = coalesce(revoked_at, now())
    where token_hash = requested_token_hash and device_hash = device_fingerprint
    returning account_id into v_account;
  if v_account is not null then
    insert into public.license_security_audit (action, outcome, actor_id) values ('revoke', 'revoked', v_account);
  end if;
  return true;
end;
$$;

-- Admin revocation must affect the current email-based model, not just the retired OAuth model.
create function public.nex_admin_revoke_email_license(target_account_id uuid, requested_actor_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.license_admin_keys where id = requested_actor_id and active) then
    raise exception 'ADMIN_NOT_ALLOWED';
  end if;
  perform id from public.email_license_accounts where id = target_account_id for update;
  update public.email_entitlements set status = 'revoked', updated_at = now() where account_id = target_account_id;
  if not found then return false; end if;
  update public.license_sessions set revoked_at = now() where account_id = target_account_id and revoked_at is null;
  -- A previously redeemed code cannot undo an administrative revocation.
  update public.license_codes set status = 'revoked' where redeemed_email_account_id = target_account_id;
  insert into public.license_security_audit (action, outcome, actor_id) values ('admin', 'revoked', requested_actor_id);
  return true;
end;
$$;

revoke all on function public.nex_consume_rate_limit(text, integer, integer),
  public.nex_verify_license_session(text, text),
  public.nex_activate_license_session(text, text, text, text, text),
  public.nex_revoke_license_session(text, text),
  public.nex_admin_revoke_email_license(uuid, uuid) from public, anon, authenticated;
grant execute on function public.nex_consume_rate_limit(text, integer, integer),
  public.nex_verify_license_session(text, text),
  public.nex_activate_license_session(text, text, text, text, text),
  public.nex_revoke_license_session(text, text),
  public.nex_admin_revoke_email_license(uuid, uuid) to service_role;

-- Disable obsolete email-only authorization APIs. Retain definitions for migration rollback review.
revoke all on function public.get_email_device_entitlement(text, text, text),
  public.redeem_email_license_code(text, text, text, text) from public, anon, authenticated, service_role;

-- Manual transfer requires an authenticated operator AND proof of a redeemed purchase code.
-- Support must separately verify order ownership before invoking this service-only function.
create function public.nex_admin_transfer_email_license(
  target_account_id uuid, requested_actor_id uuid, original_code text,
  new_device_hash text, new_device_label text
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_code uuid;
begin
  if not exists (select 1 from public.license_admin_keys where id = requested_actor_id and active) then
    raise exception 'ADMIN_NOT_ALLOWED';
  end if;
  if new_device_hash is null or new_device_hash !~ '^[a-f0-9]{64}$' or new_device_label is null
    or length(new_device_label) > 120 or original_code is null or original_code !~ '^[A-Z0-9]{8,100}$' then
    raise exception 'INVALID_TRANSFER';
  end if;
  -- Lock code before account, matching activation lock order.
  select id into v_code from public.license_codes where redeemed_email_account_id = target_account_id
    and status = 'redeemed'
    and code_hash = encode(extensions.digest(convert_to(original_code, 'UTF8'), 'sha256'), 'hex')
    for update;
  if v_code is null then raise exception 'PROOF_REQUIRED'; end if;
  perform id from public.email_license_accounts where id = target_account_id for update;
  if not exists (select 1 from public.email_entitlements where account_id = target_account_id
    and status = 'active' and expires_at > now()) then raise exception 'LICENSE_INACTIVE'; end if;
  if exists (select 1 from public.license_security_audit where actor_id = target_account_id
    and action = 'admin' and outcome = 'reviewed' and created_at > now() - interval '30 days'
    group by actor_id having count(*) >= 3) then raise exception 'TRANSFER_RATE_LIMITED'; end if;
  update public.email_license_accounts set device_hash = new_device_hash, device_label = new_device_label,
    bound_at = now(), updated_at = now() where id = target_account_id;
  update public.license_sessions set revoked_at = now() where account_id = target_account_id and revoked_at is null;
  insert into public.license_security_audit (action, outcome, actor_id) values ('admin', 'reviewed', target_account_id);
  return true;
end;
$$;
revoke all on function public.nex_admin_transfer_email_license(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.nex_admin_transfer_email_license(uuid, uuid, text, text, text) to service_role;
