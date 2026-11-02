-- AnimeFinder — Supabase Single Source of Truth V1 / Provider Cache Prerequisites
-- Run after data-integrity-master-v4.sql and before/with supabase-single-source-v1.sql.
-- Idempotent. These tables are provider caches in Supabase, never browser persistence.

create table if not exists animefinder.external_characters (
  provider text not null,
  provider_character_id bigint not null,
  canonical_name text not null,
  image_url text,
  about text,
  metadata_json jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default now(),
  primary key (provider, provider_character_id),
  constraint external_characters_provider_check check (provider in ('jikan'))
);

create table if not exists animefinder.anime_character_roster_cache (
  anime_mal_id bigint primary key,
  characters_json jsonb not null default '[]'::jsonb,
  last_synced_at timestamptz not null default now()
);

create index if not exists external_characters_synced_idx on animefinder.external_characters(last_synced_at desc);
create index if not exists anime_character_roster_cache_synced_idx on animefinder.anime_character_roster_cache(last_synced_at desc);

alter table animefinder.external_characters enable row level security;
alter table animefinder.anime_character_roster_cache enable row level security;

drop policy if exists "AnimeFinder can read external characters" on animefinder.external_characters;
create policy "AnimeFinder can read external characters" on animefinder.external_characters
for select to authenticated using (animefinder.is_authorized_user());
drop policy if exists "AnimeFinder can insert external characters" on animefinder.external_characters;
create policy "AnimeFinder can insert external characters" on animefinder.external_characters
for insert to authenticated with check (animefinder.is_authorized_user());
drop policy if exists "AnimeFinder can update external characters" on animefinder.external_characters;
create policy "AnimeFinder can update external characters" on animefinder.external_characters
for update to authenticated using (animefinder.is_authorized_user()) with check (animefinder.is_authorized_user());

drop policy if exists "AnimeFinder can read character roster cache" on animefinder.anime_character_roster_cache;
create policy "AnimeFinder can read character roster cache" on animefinder.anime_character_roster_cache
for select to authenticated using (animefinder.is_authorized_user());
drop policy if exists "AnimeFinder can insert character roster cache" on animefinder.anime_character_roster_cache;
create policy "AnimeFinder can insert character roster cache" on animefinder.anime_character_roster_cache
for insert to authenticated with check (animefinder.is_authorized_user());
drop policy if exists "AnimeFinder can update character roster cache" on animefinder.anime_character_roster_cache;
create policy "AnimeFinder can update character roster cache" on animefinder.anime_character_roster_cache
for update to authenticated using (animefinder.is_authorized_user()) with check (animefinder.is_authorized_user());

grant select, insert, update on animefinder.external_characters to authenticated;
grant select, insert, update on animefinder.anime_character_roster_cache to authenticated;

notify pgrst, 'reload schema';
