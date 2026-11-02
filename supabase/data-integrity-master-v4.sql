-- AnimeFinder — Data Integrity / Master Data V4
-- SELF-CONTAINED / IDEMPOTENT migration.
-- Supabase becomes the single source of truth for Master Data Table reads.
-- Safe to run more than once: prerequisite tables are created only when missing.

-- =====================================================
-- 0) Core schema + authorization helper
-- =====================================================
create schema if not exists animefinder;
grant usage on schema animefinder to authenticated, service_role;

create or replace function animefinder.is_authorized_user()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select auth.uid() is not null
    and lower(coalesce(auth.jwt() ->> 'email', '')) = 'leo.c.rossato@gmail.com';
$$;

grant execute on function animefinder.is_authorized_user() to authenticated;

-- =====================================================
-- 1) Prerequisite Personal Catalog table
--    This fixes ERROR 42P01 when older migrations were not run.
-- =====================================================
create table if not exists animefinder.personal_catalog_works (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  primary_mal_id bigint,
  category text not null check (category in (
    'watched','movies','manhua','dropped-unfinished','new-seasons-2026','needs-classification'
  )),
  watch_status text not null default 'unknown' check (watch_status in (
    'watched','watching','unfinished','dropped','planned','unknown'
  )),
  my_ranked integer,
  original_observations text,
  comments text,
  poster_url text,
  mal_score numeric(4,2),
  english_name text,
  original_name text,
  mal_url text,
  association_mal_ids bigint[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint personal_catalog_rank_positive check (my_ranked is null or my_ranked > 0)
);

create index if not exists personal_catalog_user_idx
  on animefinder.personal_catalog_works(user_id);
create index if not exists personal_catalog_primary_mal_idx
  on animefinder.personal_catalog_works(primary_mal_id);
create index if not exists personal_catalog_category_rank_idx
  on animefinder.personal_catalog_works(user_id, category, my_ranked);
create index if not exists personal_catalog_associations_gin_idx
  on animefinder.personal_catalog_works using gin(association_mal_ids);

alter table animefinder.personal_catalog_works enable row level security;

drop policy if exists "AnimeFinder users can read own personal works" on animefinder.personal_catalog_works;
create policy "AnimeFinder users can read own personal works"
on animefinder.personal_catalog_works for select to authenticated
using (animefinder.is_authorized_user() and auth.uid() = user_id);

drop policy if exists "AnimeFinder users can insert own personal works" on animefinder.personal_catalog_works;
create policy "AnimeFinder users can insert own personal works"
on animefinder.personal_catalog_works for insert to authenticated
with check (animefinder.is_authorized_user() and auth.uid() = user_id);

drop policy if exists "AnimeFinder users can update own personal works" on animefinder.personal_catalog_works;
create policy "AnimeFinder users can update own personal works"
on animefinder.personal_catalog_works for update to authenticated
using (animefinder.is_authorized_user() and auth.uid() = user_id)
with check (animefinder.is_authorized_user() and auth.uid() = user_id);

drop policy if exists "AnimeFinder users can delete own personal works" on animefinder.personal_catalog_works;
create policy "AnimeFinder users can delete own personal works"
on animefinder.personal_catalog_works for delete to authenticated
using (animefinder.is_authorized_user() and auth.uid() = user_id);

grant select, insert, update, delete on animefinder.personal_catalog_works to authenticated;

-- Batch catalog save RPC used by the current frontend.
create or replace function animefinder.save_personal_catalog_batch(p_works jsonb)
returns void
language plpgsql
security invoker
set search_path = animefinder, public
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
begin
  if uid is null or not animefinder.is_authorized_user() then
    raise exception 'Unauthorized';
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_works, '[]'::jsonb))
  loop
    insert into animefinder.personal_catalog_works (
      id, user_id, display_name, primary_mal_id, category, watch_status, my_ranked,
      original_observations, comments, poster_url, mal_score, english_name, original_name,
      mal_url, association_mal_ids, updated_at
    ) values (
      item->>'id', uid, item->>'display_name', nullif(item->>'primary_mal_id','')::bigint,
      item->>'category', coalesce(nullif(item->>'watch_status',''), 'unknown'),
      nullif(item->>'my_ranked','')::integer,
      item->>'original_observations', item->>'comments', item->>'poster_url',
      nullif(item->>'mal_score','')::numeric, item->>'english_name', item->>'original_name', item->>'mal_url',
      coalesce(array(select jsonb_array_elements_text(coalesce(item->'association_mal_ids','[]'::jsonb))::bigint), '{}'),
      now()
    )
    on conflict (id) do update set
      display_name = excluded.display_name,
      primary_mal_id = excluded.primary_mal_id,
      category = excluded.category,
      watch_status = excluded.watch_status,
      my_ranked = excluded.my_ranked,
      original_observations = excluded.original_observations,
      comments = excluded.comments,
      poster_url = excluded.poster_url,
      mal_score = excluded.mal_score,
      english_name = excluded.english_name,
      original_name = excluded.original_name,
      mal_url = excluded.mal_url,
      association_mal_ids = excluded.association_mal_ids,
      updated_at = now()
    where animefinder.personal_catalog_works.user_id = uid;
  end loop;
end;
$$;

grant execute on function animefinder.save_personal_catalog_batch(jsonb) to authenticated;

-- =====================================================
-- 2) Prerequisite Personal Knowledge tables
-- =====================================================
create table if not exists animefinder.personal_work_comment_versions (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  personal_work_id text not null,
  mal_id bigint,
  version_number integer not null check (version_number > 0),
  content text not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  constraint personal_work_comment_versions_unique unique (user_id, personal_work_id, version_number)
);

create table if not exists animefinder.personal_work_keywords (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  personal_work_id text not null,
  keyword text not null,
  rank integer not null check (rank > 0),
  source text not null default 'manual',
  confirmed boolean not null default false,
  confidence numeric,
  created_at timestamptz not null default now(),
  constraint personal_work_keywords_unique unique (user_id, personal_work_id, keyword)
);

create table if not exists animefinder.personal_work_characters (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  personal_work_id text not null,
  character_name text not null,
  rank integer not null default 1,
  source text not null default 'manual',
  confirmed boolean not null default false,
  confidence numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, personal_work_id, id)
);

alter table animefinder.personal_work_characters add column if not exists rank integer;
update animefinder.personal_work_characters
set rank = 1
where rank is null;
alter table animefinder.personal_work_characters alter column rank set default 1;
alter table animefinder.personal_work_characters alter column rank set not null;

create table if not exists animefinder.personal_character_comments (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  personal_work_id text not null,
  character_id text not null,
  version_number integer not null check (version_number > 0),
  content text not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  constraint personal_character_comments_unique unique (user_id, personal_work_id, character_id, version_number)
);

create table if not exists animefinder.personal_character_keywords (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  personal_work_id text not null,
  character_id text not null,
  keyword text not null,
  rank integer not null check (rank > 0),
  source text not null default 'manual',
  confirmed boolean not null default false,
  confidence numeric,
  created_at timestamptz not null default now(),
  constraint personal_character_keywords_unique unique (user_id, personal_work_id, character_id, keyword)
);

create index if not exists personal_work_comment_versions_lookup
  on animefinder.personal_work_comment_versions(user_id, personal_work_id, version_number);
create index if not exists personal_work_keywords_lookup
  on animefinder.personal_work_keywords(user_id, personal_work_id, rank);
create index if not exists personal_work_characters_lookup
  on animefinder.personal_work_characters(user_id, personal_work_id, rank);
create index if not exists personal_character_comments_lookup
  on animefinder.personal_character_comments(user_id, personal_work_id, character_id, version_number);
create index if not exists personal_character_keywords_lookup
  on animefinder.personal_character_keywords(user_id, personal_work_id, character_id, rank);

alter table animefinder.personal_work_comment_versions enable row level security;
alter table animefinder.personal_work_keywords enable row level security;
alter table animefinder.personal_work_characters enable row level security;
alter table animefinder.personal_character_comments enable row level security;
alter table animefinder.personal_character_keywords enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'personal_work_comment_versions',
    'personal_work_keywords',
    'personal_work_characters',
    'personal_character_comments',
    'personal_character_keywords'
  ] loop
    execute format('drop policy if exists "AnimeFinder can read own %1$s" on animefinder.%1$I', t);
    execute format('create policy "AnimeFinder can read own %1$s" on animefinder.%1$I for select to authenticated using (animefinder.is_authorized_user() and auth.uid() = user_id)', t);
    execute format('drop policy if exists "AnimeFinder can insert own %1$s" on animefinder.%1$I', t);
    execute format('create policy "AnimeFinder can insert own %1$s" on animefinder.%1$I for insert to authenticated with check (animefinder.is_authorized_user() and auth.uid() = user_id)', t);
    execute format('drop policy if exists "AnimeFinder can update own %1$s" on animefinder.%1$I', t);
    execute format('create policy "AnimeFinder can update own %1$s" on animefinder.%1$I for update to authenticated using (animefinder.is_authorized_user() and auth.uid() = user_id) with check (animefinder.is_authorized_user() and auth.uid() = user_id)', t);
    execute format('drop policy if exists "AnimeFinder can delete own %1$s" on animefinder.%1$I', t);
    execute format('create policy "AnimeFinder can delete own %1$s" on animefinder.%1$I for delete to authenticated using (animefinder.is_authorized_user() and auth.uid() = user_id)', t);
  end loop;
end $$;

grant select, insert, update, delete on animefinder.personal_work_comment_versions to authenticated;
grant select, insert, update, delete on animefinder.personal_work_keywords to authenticated;
grant select, insert, update, delete on animefinder.personal_work_characters to authenticated;
grant select, insert, update, delete on animefinder.personal_character_comments to authenticated;
grant select, insert, update, delete on animefinder.personal_character_keywords to authenticated;
grant usage, select on all sequences in schema animefinder to authenticated;

-- =====================================================
-- 3) Synopsis cache + multi-provider character sources
-- =====================================================
create table if not exists animefinder.personal_work_synopsis (
  user_id uuid not null references auth.users(id) on delete cascade,
  personal_work_id text not null,
  mal_id bigint,
  synopsis_original text,
  synopsis_pt_br text,
  synopsis_source text,
  synopsis_source_language text,
  status text not null default 'failed',
  last_error text,
  synopsis_fetched_at timestamptz,
  synopsis_translated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, personal_work_id)
);

alter table animefinder.personal_work_synopsis
  add column if not exists synopsis_translated_at timestamptz;

create index if not exists personal_work_synopsis_mal_idx
  on animefinder.personal_work_synopsis(user_id, mal_id);
create index if not exists personal_work_synopsis_status_idx
  on animefinder.personal_work_synopsis(user_id, status);

alter table animefinder.personal_work_synopsis enable row level security;

drop policy if exists "AnimeFinder can read own synopsis" on animefinder.personal_work_synopsis;
create policy "AnimeFinder can read own synopsis"
on animefinder.personal_work_synopsis for select to authenticated
using (animefinder.is_authorized_user() and auth.uid() = user_id);

drop policy if exists "AnimeFinder can insert own synopsis" on animefinder.personal_work_synopsis;
create policy "AnimeFinder can insert own synopsis"
on animefinder.personal_work_synopsis for insert to authenticated
with check (animefinder.is_authorized_user() and auth.uid() = user_id);

drop policy if exists "AnimeFinder can update own synopsis" on animefinder.personal_work_synopsis;
create policy "AnimeFinder can update own synopsis"
on animefinder.personal_work_synopsis for update to authenticated
using (animefinder.is_authorized_user() and auth.uid() = user_id)
with check (animefinder.is_authorized_user() and auth.uid() = user_id);

grant select, insert, update, delete on animefinder.personal_work_synopsis to authenticated;

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
  constraint personal_character_external_sources_provider_check
    check (provider in ('jikan','fandom'))
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

grant select, insert, update, delete on animefinder.personal_character_external_sources to authenticated;

-- Re-run legacy Jikan links only when the legacy table exists.
do $$
begin
  if to_regclass('animefinder.personal_character_external_links') is not null then
    execute $sql$
      insert into animefinder.personal_character_external_sources(
        user_id, personal_work_id, personal_character_id, provider,
        external_id, canonical_name, url, image_url, metadata_json,
        confirmed, last_synced_at
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
        url = coalesce(excluded.url, animefinder.personal_character_external_sources.url),
        image_url = coalesce(excluded.image_url, animefinder.personal_character_external_sources.image_url),
        metadata_json = animefinder.personal_character_external_sources.metadata_json || excluded.metadata_json,
        confirmed = true,
        last_synced_at = greatest(animefinder.personal_character_external_sources.last_synced_at, excluded.last_synced_at)
    $sql$;
  end if;
end $$;

-- =====================================================
-- 4) Persisted external work metadata (genres first)
-- =====================================================
create table if not exists animefinder.personal_work_external_metadata (
  user_id uuid not null references auth.users(id) on delete cascade,
  personal_work_id text not null,
  mal_id bigint,
  genres text[] not null default '{}',
  metadata_provider text,
  metadata_fetched_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, personal_work_id)
);

create index if not exists personal_work_external_metadata_mal_idx
  on animefinder.personal_work_external_metadata(user_id, mal_id);

alter table animefinder.personal_work_external_metadata enable row level security;

drop policy if exists "AnimeFinder can read own external work metadata" on animefinder.personal_work_external_metadata;
create policy "AnimeFinder can read own external work metadata"
on animefinder.personal_work_external_metadata for select to authenticated
using (animefinder.is_authorized_user() and auth.uid() = user_id);

drop policy if exists "AnimeFinder can insert own external work metadata" on animefinder.personal_work_external_metadata;
create policy "AnimeFinder can insert own external work metadata"
on animefinder.personal_work_external_metadata for insert to authenticated
with check (animefinder.is_authorized_user() and auth.uid() = user_id);

drop policy if exists "AnimeFinder can update own external work metadata" on animefinder.personal_work_external_metadata;
create policy "AnimeFinder can update own external work metadata"
on animefinder.personal_work_external_metadata for update to authenticated
using (animefinder.is_authorized_user() and auth.uid() = user_id)
with check (animefinder.is_authorized_user() and auth.uid() = user_id);

grant select, insert, update on animefinder.personal_work_external_metadata to authenticated;

-- =====================================================
-- 5) Safe bootstrap: insert ONLY Personal Works missing in Supabase.
-- =====================================================
create or replace function animefinder.insert_missing_personal_catalog_works(p_works jsonb)
returns integer
language plpgsql
security invoker
set search_path = animefinder, public
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  affected integer := 0;
  inserted_count integer := 0;
begin
  if uid is null or not animefinder.is_authorized_user() then
    raise exception 'Unauthorized';
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_works, '[]'::jsonb))
  loop
    insert into animefinder.personal_catalog_works (
      id, user_id, display_name, primary_mal_id, category, watch_status, my_ranked,
      original_observations, comments, poster_url, mal_score, english_name, original_name,
      mal_url, association_mal_ids, updated_at
    ) values (
      item->>'id', uid, item->>'display_name', nullif(item->>'primary_mal_id','')::bigint,
      item->>'category', coalesce(nullif(item->>'watch_status',''), 'unknown'),
      nullif(item->>'my_ranked','')::integer,
      item->>'original_observations', item->>'comments', item->>'poster_url',
      nullif(item->>'mal_score','')::numeric, item->>'english_name', item->>'original_name', item->>'mal_url',
      coalesce(array(select jsonb_array_elements_text(coalesce(item->'association_mal_ids','[]'::jsonb))::bigint), '{}'),
      now()
    )
    on conflict (id) do nothing;

    get diagnostics affected = row_count;
    inserted_count := inserted_count + affected;
  end loop;

  return inserted_count;
end;
$$;

grant execute on function animefinder.insert_missing_personal_catalog_works(jsonb) to authenticated;

-- =====================================================
-- 6) One aggregate RPC for the entire Master Data Table.
--    Optional relations never remove a Personal Work.
-- =====================================================
create or replace function animefinder.get_master_data_snapshot()
returns jsonb
language sql
security invoker
set search_path = animefinder, public
as $$
with work_rows as (
  select
    w.id,
    w.display_name,
    w.primary_mal_id,
    w.category,
    w.watch_status,
    w.my_ranked,
    w.original_observations,
    w.comments as catalog_comments,
    w.poster_url,
    w.mal_score,
    w.english_name,
    w.original_name,
    w.mal_url,
    w.association_mal_ids,
    coalesce((
      select v.content
      from animefinder.personal_work_comment_versions v
      where v.user_id = w.user_id and v.personal_work_id = w.id
      order by v.version_number desc, v.created_at desc
      limit 1
    ), w.comments, '') as current_comment,
    coalesce((
      select jsonb_agg(k.keyword order by k.rank, k.keyword)
      from animefinder.personal_work_keywords k
      where k.user_id = w.user_id
        and k.personal_work_id = w.id
        and k.confirmed = true
    ), '[]'::jsonb) as work_keywords,
    coalesce(meta.genres, '{}') as genres,
    meta.metadata_provider,
    meta.metadata_fetched_at,
    syn.synopsis_original,
    syn.synopsis_pt_br,
    syn.synopsis_source,
    syn.synopsis_source_language,
    syn.synopsis_fetched_at,
    syn.synopsis_translated_at,
    syn.status as synopsis_status,
    syn.last_error as synopsis_last_error,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'rank', c.rank,
          'name', c.character_name,
          'comment', coalesce((
            select cc.content
            from animefinder.personal_character_comments cc
            where cc.user_id = c.user_id
              and cc.personal_work_id = c.personal_work_id
              and cc.character_id = c.id
            order by cc.version_number desc, cc.created_at desc
            limit 1
          ), ''),
          'keywords', coalesce((
            select jsonb_agg(ck.keyword order by ck.rank, ck.keyword)
            from animefinder.personal_character_keywords ck
            where ck.user_id = c.user_id
              and ck.personal_work_id = c.personal_work_id
              and ck.character_id = c.id
              and ck.confirmed = true
          ), '[]'::jsonb),
          'externalSources', coalesce((
            select jsonb_object_agg(
              es.provider,
              jsonb_build_object(
                'externalId', es.external_id,
                'canonicalName', es.canonical_name,
                'url', es.url,
                'imageUrl', es.image_url,
                'metadata', es.metadata_json,
                'confirmed', es.confirmed,
                'lastSyncedAt', es.last_synced_at
              )
            )
            from animefinder.personal_character_external_sources es
            where es.user_id = c.user_id
              and es.personal_work_id = c.personal_work_id
              and es.personal_character_id = c.id
              and es.confirmed = true
          ), '{}'::jsonb)
        )
        order by c.rank, c.character_name
      )
      from animefinder.personal_work_characters c
      where c.user_id = w.user_id
        and c.personal_work_id = w.id
        and c.confirmed = true
    ), '[]'::jsonb) as character_knowledge,
    exists(
      select 1
      from animefinder.personal_work_characters ec
      join animefinder.personal_character_external_sources ees
        on ees.user_id = ec.user_id
       and ees.personal_work_id = ec.personal_work_id
       and ees.personal_character_id = ec.id
       and ees.confirmed = true
      where ec.user_id = w.user_id
        and ec.personal_work_id = w.id
        and ec.confirmed = true
    ) as has_character_external_links
  from animefinder.personal_catalog_works w
  left join animefinder.personal_work_external_metadata meta
    on meta.user_id = w.user_id and meta.personal_work_id = w.id
  left join animefinder.personal_work_synopsis syn
    on syn.user_id = w.user_id and syn.personal_work_id = w.id
  where w.user_id = auth.uid()
), category_counts as (
  select category, count(*)::integer as count
  from work_rows
  group by category
)
select jsonb_build_object(
  'source', 'supabase',
  'generatedAt', now(),
  'totalWorks', (select count(*)::integer from work_rows),
  'categoryCounts', coalesce((select jsonb_object_agg(category, count) from category_counts), '{}'::jsonb),
  'works', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'displayName', r.display_name,
        'primaryMalId', r.primary_mal_id,
        'category', r.category,
        'watchStatus', r.watch_status,
        'myRanked', r.my_ranked,
        'originalObservations', r.original_observations,
        'comment', r.current_comment,
        'posterUrl', r.poster_url,
        'malScore', r.mal_score,
        'englishName', r.english_name,
        'originalName', r.original_name,
        'malUrl', r.mal_url,
        'associationMalIds', to_jsonb(r.association_mal_ids),
        'keywords', r.work_keywords,
        'genres', to_jsonb(r.genres),
        'metadataProvider', r.metadata_provider,
        'metadataFetchedAt', r.metadata_fetched_at,
        'synopsis', jsonb_build_object(
          'original', r.synopsis_original,
          'ptBR', r.synopsis_pt_br,
          'provider', r.synopsis_source,
          'sourceLanguage', r.synopsis_source_language,
          'fetchedAt', r.synopsis_fetched_at,
          'translatedAt', r.synopsis_translated_at,
          'status', r.synopsis_status,
          'lastError', r.synopsis_last_error
        ),
        'characterKnowledge', r.character_knowledge,
        'audit', jsonb_build_object(
          'hasMalId', r.primary_mal_id is not null,
          'hasGenres', cardinality(r.genres) > 0,
          'hasSynopsisOriginal', nullif(trim(coalesce(r.synopsis_original, '')), '') is not null,
          'hasSynopsisPtBr', nullif(trim(coalesce(r.synopsis_pt_br, '')), '') is not null,
          'hasPersonalComment', nullif(trim(coalesce(r.current_comment, '')), '') is not null,
          'hasKeywords', jsonb_array_length(r.work_keywords) > 0,
          'hasCharacters', jsonb_array_length(r.character_knowledge) > 0,
          'hasCharacterExternalLinks', r.has_character_external_links
        )
      )
      order by r.category, r.my_ranked nulls last, r.display_name
    )
    from work_rows r
  ), '[]'::jsonb)
);
$$;

grant execute on function animefinder.get_master_data_snapshot() to authenticated;

notify pgrst, 'reload schema';
