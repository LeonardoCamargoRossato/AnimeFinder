-- AnimeFinder — Character Knowledge V2
-- Multiple confirmed external sources per Personal Character.
-- Jikan/MAL remains primary; Fandom is optional fallback/complementary metadata.

create table if not exists animefinder.personal_character_external_sources (
  user_id uuid not null references auth.users(id) on delete cascade,
  personal_work_id text not null,
  personal_character_id text not null,
  provider text not null,
  external_id text not null,
  canonical_name text not null,
  url text,
  image_url text,
  metadata_json jsonb not null default '{}'::jsonb,
  confirmed boolean not null default true,
  last_synced_at timestamptz not null default now(),
  primary key (user_id, personal_work_id, personal_character_id, provider),
  constraint personal_character_external_sources_provider_check check (provider in ('jikan','fandom'))
);

create index if not exists personal_character_external_sources_work_idx
  on animefinder.personal_character_external_sources(user_id, personal_work_id);
create index if not exists personal_character_external_sources_character_idx
  on animefinder.personal_character_external_sources(user_id, personal_work_id, personal_character_id);

alter table animefinder.personal_character_external_sources enable row level security;

drop policy if exists "AnimeFinder can read own external character sources" on animefinder.personal_character_external_sources;
create policy "AnimeFinder can read own external character sources"
on animefinder.personal_character_external_sources for select to authenticated
using (animefinder.is_authorized_user() and auth.uid() = user_id);

drop policy if exists "AnimeFinder can insert own external character sources" on animefinder.personal_character_external_sources;
create policy "AnimeFinder can insert own external character sources"
on animefinder.personal_character_external_sources for insert to authenticated
with check (animefinder.is_authorized_user() and auth.uid() = user_id);

drop policy if exists "AnimeFinder can update own external character sources" on animefinder.personal_character_external_sources;
create policy "AnimeFinder can update own external character sources"
on animefinder.personal_character_external_sources for update to authenticated
using (animefinder.is_authorized_user() and auth.uid() = user_id)
with check (animefinder.is_authorized_user() and auth.uid() = user_id);

drop policy if exists "AnimeFinder can delete own external character sources" on animefinder.personal_character_external_sources;
create policy "AnimeFinder can delete own external character sources"
on animefinder.personal_character_external_sources for delete to authenticated
using (animefinder.is_authorized_user() and auth.uid() = user_id);

grant select, insert, update, delete on animefinder.personal_character_external_sources to authenticated;

-- Backfill already confirmed legacy Jikan links into the multi-provider source table.
insert into animefinder.personal_character_external_sources(
  user_id,
  personal_work_id,
  personal_character_id,
  provider,
  external_id,
  canonical_name,
  url,
  image_url,
  metadata_json,
  confirmed,
  last_synced_at
)
select
  user_id,
  personal_work_id,
  personal_character_id,
  'jikan',
  provider_character_id::text,
  canonical_name,
  'https://myanimelist.net/character/' || provider_character_id::text,
  image_url,
  jsonb_build_object('role', role, 'confidence', confidence, 'legacy_link_state', link_state),
  true,
  updated_at
from animefinder.personal_character_external_links
where provider = 'jikan'
on conflict (user_id, personal_work_id, personal_character_id, provider)
do update set
  external_id = excluded.external_id,
  canonical_name = excluded.canonical_name,
  url = excluded.url,
  image_url = excluded.image_url,
  metadata_json = animefinder.personal_character_external_sources.metadata_json || excluded.metadata_json,
  confirmed = true,
  last_synced_at = greatest(animefinder.personal_character_external_sources.last_synced_at, excluded.last_synced_at);
