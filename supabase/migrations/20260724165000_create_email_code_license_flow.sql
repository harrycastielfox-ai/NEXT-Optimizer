create table if not exists public.email_license_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  email_hash text not null unique check (email_hash ~ '^[a-f0-9]{64}$'),
  device_hash text check (device_hash is null or device_hash ~ '^[a-f0-9]{64}$'),
  device_label text not null default 'PC Windows' check (char_length(device_label) <= 120),
  bound_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_entitlements (
  account_id uuid primary key references public.email_license_accounts(id) on delete cascade,
  plan_id text not null references public.plans(id),
  status text not null default 'active' check (status in ('active', 'revoked')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  source_code_id uuid references public.license_codes(id),
  updated_at timestamptz not null default now()
);

alter table public.license_codes
add column if not exists redeemed_email_account_id uuid
references public.email_license_accounts(id) on delete set null;

create index if not exists email_license_accounts_email_hash_idx
on public.email_license_accounts(email_hash);

create index if not exists email_license_accounts_device_hash_idx
on public.email_license_accounts(device_hash);

create index if not exists email_entitlements_expires_at_idx
on public.email_entitlements(expires_at);

alter table public.email_license_accounts enable row level security;
alter table public.email_entitlements enable row level security;

revoke all on public.email_license_accounts from anon, authenticated;
revoke all on public.email_entitlements from anon, authenticated;

create or replace function public.redeem_email_license_code(
  requested_email text,
  redemption_code text,
  device_fingerprint text,
  requested_device_label text default 'PC Windows'
)
returns table (
  account_id uuid,
  account_email text,
  access_allowed boolean,
  access_reason text,
  license_plan_id text,
  license_plan_name text,
  license_status text,
  license_starts_at timestamptz,
  license_expires_at timestamptz,
  licensed_device_label text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(requested_email, '')));
  v_email_hash text;
  v_normalized_code text;
  v_code_hash text;
  v_device_hash text := lower(trim(coalesce(device_fingerprint, '')));
  v_device_label text := left(trim(coalesce(requested_device_label, 'PC Windows')), 120);
  v_account_id uuid;
  v_bound_device_hash text;
  v_code_id uuid;
  v_assigned_email_hash text;
  v_plan_id text;
  v_plan_name text;
  v_duration_days integer;
  v_code_expires_at timestamptz;
  v_previous_expires_at timestamptz;
  v_new_expires_at timestamptz;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'ACCOUNT_EMAIL_REQUIRED';
  end if;

  if v_device_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_DEVICE';
  end if;

  v_normalized_code := upper(regexp_replace(coalesce(redemption_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_normalized_code) < 8 then
    raise exception 'INVALID_CODE';
  end if;

  v_email_hash := encode(extensions.digest(convert_to(v_email, 'UTF8'), 'sha256'), 'hex');
  v_code_hash := encode(extensions.digest(convert_to(v_normalized_code, 'UTF8'), 'sha256'), 'hex');

  select c.id, c.plan_id, p.name, p.duration_days, c.expires_at, c.assigned_email_hash
    into v_code_id, v_plan_id, v_plan_name, v_duration_days, v_code_expires_at,
      v_assigned_email_hash
  from public.license_codes c
  join public.plans p on p.id = c.plan_id and p.active = true
  where c.code_hash = v_code_hash
    and c.status = 'available'
  for update of c;

  if v_code_id is null then
    raise exception 'CODE_INVALID_OR_ALREADY_USED';
  end if;

  if v_code_expires_at is not null and v_code_expires_at <= now() then
    raise exception 'CODE_EXPIRED';
  end if;

  if v_assigned_email_hash is null then
    raise exception 'CODE_NOT_ASSIGNED';
  end if;

  if v_assigned_email_hash is distinct from v_email_hash then
    raise exception 'CODE_ASSIGNED_TO_ANOTHER_ACCOUNT';
  end if;

  insert into public.email_license_accounts (
    email,
    email_hash,
    device_hash,
    device_label,
    bound_at,
    last_seen_at,
    updated_at
  )
  values (
    v_email,
    v_email_hash,
    v_device_hash,
    case when v_device_label = '' then 'PC Windows' else v_device_label end,
    now(),
    now(),
    now()
  )
  on conflict (email_hash) do update
  set
    email = excluded.email,
    updated_at = now()
  returning id, device_hash
  into v_account_id, v_bound_device_hash;

  select a.device_hash
    into v_bound_device_hash
  from public.email_license_accounts a
  where a.id = v_account_id
  for update;

  if v_bound_device_hash is null then
    update public.email_license_accounts
    set
      device_hash = v_device_hash,
      device_label = case when v_device_label = '' then 'PC Windows' else v_device_label end,
      bound_at = now(),
      last_seen_at = now(),
      updated_at = now()
    where id = v_account_id;
  elsif v_bound_device_hash is distinct from v_device_hash then
    raise exception 'DEVICE_ALREADY_BOUND';
  else
    update public.email_license_accounts
    set
      last_seen_at = now(),
      updated_at = now()
    where id = v_account_id;
  end if;

  select e.expires_at
    into v_previous_expires_at
  from public.email_entitlements e
  where e.account_id = v_account_id
  for update;

  v_new_expires_at := greatest(coalesce(v_previous_expires_at, now()), now())
    + make_interval(days => v_duration_days);

  insert into public.email_entitlements (
    account_id,
    plan_id,
    status,
    starts_at,
    expires_at,
    source_code_id,
    updated_at
  )
  values (
    v_account_id,
    v_plan_id,
    'active',
    now(),
    v_new_expires_at,
    v_code_id,
    now()
  )
  on conflict on constraint email_entitlements_pkey do update
  set
    plan_id = excluded.plan_id,
    status = 'active',
    expires_at = excluded.expires_at,
    source_code_id = excluded.source_code_id,
    updated_at = now();

  update public.license_codes
  set
    status = 'redeemed',
    redeemed_email_account_id = v_account_id,
    redeemed_at = now()
  where id = v_code_id;

  return query
  select
    v_account_id,
    v_email,
    true,
    'ALLOWED'::text,
    v_plan_id,
    v_plan_name,
    'active'::text,
    now(),
    v_new_expires_at,
    case when v_device_label = '' then 'PC Windows' else v_device_label end;
end;
$$;

create or replace function public.get_email_device_entitlement(
  requested_email text,
  device_fingerprint text,
  requested_device_label text default 'PC Windows'
)
returns table (
  account_id uuid,
  account_email text,
  access_allowed boolean,
  access_reason text,
  license_plan_id text,
  license_plan_name text,
  license_status text,
  license_starts_at timestamptz,
  license_expires_at timestamptz,
  licensed_device_label text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(coalesce(requested_email, '')));
  v_email_hash text;
  v_device_hash text := lower(trim(coalesce(device_fingerprint, '')));
  v_device_label text := left(trim(coalesce(requested_device_label, 'PC Windows')), 120);
  v_account_id uuid;
  v_bound_device_hash text;
  v_bound_device_label text;
  v_plan_id text;
  v_plan_name text;
  v_status text;
  v_starts_at timestamptz;
  v_expires_at timestamptz;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'ACCOUNT_EMAIL_REQUIRED';
  end if;

  if v_device_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_DEVICE';
  end if;

  v_email_hash := encode(extensions.digest(convert_to(v_email, 'UTF8'), 'sha256'), 'hex');

  select a.id, a.device_hash, a.device_label
    into v_account_id, v_bound_device_hash, v_bound_device_label
  from public.email_license_accounts a
  where a.email_hash = v_email_hash;

  if v_account_id is null then
    return query select null::uuid, v_email, false, 'NO_ENTITLEMENT'::text,
      null::text, null::text, null::text, null::timestamptz, null::timestamptz,
      null::text;
    return;
  end if;

  select e.plan_id, p.name, e.status, e.starts_at, e.expires_at
    into v_plan_id, v_plan_name, v_status, v_starts_at, v_expires_at
  from public.email_entitlements e
  join public.plans p on p.id = e.plan_id
  where e.account_id = v_account_id;

  if v_plan_id is null then
    return query select v_account_id, v_email, false, 'NO_ENTITLEMENT'::text,
      null::text, null::text, null::text, null::timestamptz, null::timestamptz,
      v_bound_device_label;
    return;
  end if;

  if v_status = 'revoked' then
    return query select v_account_id, v_email, false, 'REVOKED'::text,
      v_plan_id, v_plan_name, v_status, v_starts_at, v_expires_at, v_bound_device_label;
    return;
  end if;

  if v_expires_at <= now() then
    return query select v_account_id, v_email, false, 'EXPIRED'::text,
      v_plan_id, v_plan_name, 'expired'::text, v_starts_at, v_expires_at,
      v_bound_device_label;
    return;
  end if;

  if v_bound_device_hash is distinct from v_device_hash then
    return query select v_account_id, v_email, false, 'DEVICE_MISMATCH'::text,
      v_plan_id, v_plan_name, v_status, v_starts_at, v_expires_at, v_bound_device_label;
    return;
  end if;

  update public.email_license_accounts
  set
    device_label = case when v_device_label = '' then device_label else v_device_label end,
    last_seen_at = now(),
    updated_at = now()
  where id = v_account_id;

  return query select v_account_id, v_email, true, 'ALLOWED'::text,
    v_plan_id, v_plan_name, v_status, v_starts_at, v_expires_at, v_bound_device_label;
end;
$$;

revoke all on function public.redeem_email_license_code(text, text, text, text) from public;
revoke all on function public.redeem_email_license_code(text, text, text, text) from anon;
revoke all on function public.redeem_email_license_code(text, text, text, text) from authenticated;
grant execute on function public.redeem_email_license_code(text, text, text, text) to service_role;

revoke all on function public.get_email_device_entitlement(text, text, text) from public;
revoke all on function public.get_email_device_entitlement(text, text, text) from anon;
revoke all on function public.get_email_device_entitlement(text, text, text) from authenticated;
grant execute on function public.get_email_device_entitlement(text, text, text) to service_role;

comment on table public.email_license_accounts is
  'Contas de licença NEX por e-mail. O dispositivo fica vinculado por hash derivado localmente.';

comment on table public.email_entitlements is
  'Assinaturas NEX ativadas por código de uso único e e-mail.';

comment on function public.redeem_email_license_code(text, text, text, text) is
  'Ativa e vincula código NEX a e-mail e máquina. Deve ser chamada somente pela Edge Function com service_role.';

comment on function public.get_email_device_entitlement(text, text, text) is
  'Verifica licença NEX por e-mail e dispositivo. Deve ser chamada somente pela Edge Function com service_role.';

