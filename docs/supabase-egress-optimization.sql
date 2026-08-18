-- Supabase PostgREST egress optimizations.
-- Safe to run repeatedly after the account/app-market tables exist.

create or replace function public.app_get_current_account(
  p_token_hash text,
  p_now timestamptz default now(),
  p_touch_interval_seconds integer default 300
)
returns table (id text, username text, display_name text, status text, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare v_user_id text; v_touch_seconds integer := greatest(coalesce(p_touch_interval_seconds, 300), 60);
begin
  select s.user_id into v_user_id from public.app_sessions s where s.token_hash=p_token_hash and s.expires_at>p_now limit 1;
  if v_user_id is null then return; end if;
  update public.app_sessions s set last_seen_at=p_now where s.token_hash=p_token_hash and (s.last_seen_at is null or s.last_seen_at < p_now-make_interval(secs=>v_touch_seconds));
  return query select u.id,u.username,u.display_name,u.status,u.created_at,u.updated_at from public.app_users u where u.id=v_user_id and u.status<>'disabled' limit 1;
end; $$;
revoke all on function public.app_get_current_account(text,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.app_get_current_account(text,timestamptz,integer) to service_role;

create or replace function public.app_market_list(p_author_id text default null)
returns table (id text, app_id text, name text, version text, changelog text, description text, permissions jsonb, manifest jsonb, package_kind text, package_size integer, author_id text, author_name text, author_avatar text, review_status text, install_count integer, like_count integer, created_at timestamptz, updated_at timestamptz, has_icon boolean)
language sql security definer set search_path=public
as $$
  select a.id,a.app_id,a.name,a.version,a.changelog,a.description,a.permissions,a.manifest,a.package_kind,a.package_size,a.author_id,a.author_name,a.author_avatar,a.review_status,a.install_count,a.like_count,a.created_at,a.updated_at,coalesce(a.icon_data_url,'')<>'' as has_icon
  from public.custom_app_market_apps a
  where a.deleted_at is null and ((p_author_id is null and a.review_status='approved') or (p_author_id is not null and a.author_id=p_author_id))
  order by a.updated_at desc limit case when p_author_id is null then 80 else 100 end;
$$;
revoke all on function public.app_market_list(text) from public, anon, authenticated;
grant execute on function public.app_market_list(text) to service_role;

-- For Edge Function push scheduling, keep the 10-second scan cadence but lease a due
-- pending job for 60 seconds before net.http_post. Healthy functions claim immediately;
-- quota/gateway failures therefore back off instead of retrying every 10 seconds.
-- Use your project ref in the push-generate / push-bridge URLs when configuring cron.
