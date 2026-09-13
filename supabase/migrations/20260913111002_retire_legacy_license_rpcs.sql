-- The supported app uses opaque sessions, not the retired OAuth activation flow.
-- Keep definitions/data for historical compatibility, but remove callable mutation paths.
revoke all on function public.cancel_device_transfer(uuid),
  public.get_device_entitlement(text, text),
  public.redeem_license_code(text, text, text),
  public.request_device_transfer(text, text)
  from public, anon, authenticated, service_role;

-- Admin list_transfers reads this legacy history; new Supabase projects do not
-- automatically grant service_role table access.
grant select on public.device_transfer_requests to service_role;

create index if not exists email_entitlements_plan_id_idx
  on public.email_entitlements(plan_id);
create index if not exists email_entitlements_source_code_id_idx
  on public.email_entitlements(source_code_id);
create index if not exists license_codes_redeemed_email_account_id_idx
  on public.license_codes(redeemed_email_account_id);
