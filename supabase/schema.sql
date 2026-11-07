-- Halyard Browser: database schema for Supabase.
-- Run once in your project: Supabase dashboard > SQL Editor > New query > paste > Run.
-- Safe to run again: it only creates what is missing and resets the policies.
--
-- What it stores: one row per account with the name, language and theme that Halyard
-- syncs between computers. Nothing about browsing (no history, no sites) leaves the PC.
--
-- Security model:
--   * Row-level security is on: a signed-in user can only read and change their own row.
--   * Logged-out visitors (role anon) get no access at all.
--   * Nobody can delete rows through the API; a row goes away with its account (cascade).
--   * New tables are not exposed to the Data API by default, so access is granted explicitly
--     and only to the authenticated role.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  language text not null default 'en' check (language in ('en', 'pt-BR', 'es')),
  theme text not null default 'system' check (theme in ('system', 'dark', 'light')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Halyard Browser: per-account preferences synced between computers.';

alter table public.profiles enable row level security;

-- least privilege: start from nothing, then allow only what the app uses
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
-- column by column: created_at can never be written from the app, updated_at is set by the trigger below
-- (id stays in UPDATE because upsert rewrites it; the policies stop it from pointing at another account)
grant insert (id, display_name, language, theme, updated_at) on table public.profiles to authenticated;
grant update (id, display_name, language, theme, updated_at) on table public.profiles to authenticated;

-- the server's clock decides when a row changed, not the client's.
-- Also one profile write per second per account: the app waits 1.5 s between saves, so only
-- scripts hammering the API hit this. PT429 makes the Data API answer HTTP 429.
create or replace function public.profiles_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.updated_at > now() - interval '1 second' then
    raise exception 'too many profile updates, try again shortly' using errcode = 'PT429';
  end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before insert or update on public.profiles
  for each row execute function public.profiles_touch();

-- the trigger function is not part of the API
revoke all on function public.profiles_touch() from public, anon, authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

-- USING picks the rows you may touch; WITH CHECK stops moving a row to another account
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
