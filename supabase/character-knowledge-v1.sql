-- AnimeFinder — Character Knowledge V1
-- Jikan/MAL external character cache + personal work character linking.
-- Run after the existing AnimeFinder Personal Knowledge migrations.

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

create table if not exists animefinder.personal_character_external_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  personal_work_id text not null,
  personal_character_id text not null,
  provider text not null default 'jikan',
  provider_character_id bigint not null,
  canonical_name text not null,
  image_url text,
  role text,
  link_state text not null default 'linked',
  confidence numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, personal_work_id, personal_character_id),
  constraint personal_character_external_links_provider_check check (provider in ('jikan')),
  constraint personal_character_external_links_state_check check (link_state in ('unlinked','suggested_match','linked','manual')),
  constraint personal_character_external_links_external_fk
    foreign key (provider, provider_character_id)
    references animefinder.external_characters(provider, provider_character_id)
    on update cascade on delete restrict
);

create index if not exists personal_character_external_links_work_idx
  on animefinder.personal_character_external_links(user_id, personal_work_id);
create index if not exists personal_character_external_links_external_idx
  on animefinder.personal_character_external_links(provider, provider_character_id);
create index if not exists external_characters_synced_idx
  on animefinder.external_characters(last_synced_at desc);

alter table animefinder.external_characters enable row level security;
alter table animefinder.personal_character_external_links enable row level security;

drop policy if exists "AnimeFinder can read external characters" on animefinder.external_characters;
create policy "AnimeFinder can read external characters"
on animefinder.external_characters for select to authenticated
using (animefinder.is_authorized_user());

drop policy if exists "AnimeFinder can insert external characters" on animefinder.external_characters;
create policy "AnimeFinder can insert external characters"
on animefinder.external_characters for insert to authenticated
with check (animefinder.is_authorized_user());

drop policy if exists "AnimeFinder can update external characters" on animefinder.external_characters;
create policy "AnimeFinder can update external characters"
on animefinder.external_characters for update to authenticated
using (animefinder.is_authorized_user())
with check (animefinder.is_authorized_user());

drop policy if exists "AnimeFinder can read own character links" on animefinder.personal_character_external_links;
create policy "AnimeFinder can read own character links"
on animefinder.personal_character_external_links for select to authenticated
using (animefinder.is_authorized_user() and auth.uid() = user_id);

drop policy if exists "AnimeFinder can insert own character links" on animefinder.personal_character_external_links;
create policy "AnimeFinder can insert own character links"
on animefinder.personal_character_external_links for insert to authenticated
with check (animefinder.is_authorized_user() and auth.uid() = user_id);

drop policy if exists "AnimeFinder can update own character links" on animefinder.personal_character_external_links;
create policy "AnimeFinder can update own character links"
on animefinder.personal_character_external_links for update to authenticated
using (animefinder.is_authorized_user() and auth.uid() = user_id)
with check (animefinder.is_authorized_user() and auth.uid() = user_id);

drop policy if exists "AnimeFinder can delete own character links" on animefinder.personal_character_external_links;
create policy "AnimeFinder can delete own character links"
on animefinder.personal_character_external_links for delete to authenticated
using (animefinder.is_authorized_user() and auth.uid() = user_id);

grant select, insert, update on animefinder.external_characters to authenticated;
grant select, insert, update, delete on animefinder.personal_character_external_links to authenticated;

-- Optional cleanup helper: keeps link timestamps consistent when updates are performed directly.
create or replace function animefinder.touch_character_link_updated_at()
returns trigger
language plpgsql
set search_path = animefinder, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists personal_character_external_links_touch_updated_at on animefinder.personal_character_external_links;
create trigger personal_character_external_links_touch_updated_at
before update on animefinder.personal_character_external_links
for each row execute function animefinder.touch_character_link_updated_at();
