-- AnimeFinder — Supabase Single Source of Truth V1
-- Run AFTER supabase/data-integrity-master-v4.sql.
-- Idempotent: it only adds/updates structures required by the Supabase-only runtime.

create schema if not exists animefinder;

-- =====================================================
-- 1) Comments must exist in Supabase (no browser fallback)
-- =====================================================
create table if not exists animefinder.anime_comments (
  user_id uuid not null references auth.users(id) on delete cascade,
  mal_id bigint not null,
  content_html text not null default '',
  content_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, mal_id)
);
alter table animefinder.anime_comments enable row level security;
drop policy if exists "AnimeFinder users can read own anime comments" on animefinder.anime_comments;
create policy "AnimeFinder users can read own anime comments" on animefinder.anime_comments
for select to authenticated using (animefinder.is_authorized_user() and auth.uid() = user_id);
drop policy if exists "AnimeFinder users can insert own anime comments" on animefinder.anime_comments;
create policy "AnimeFinder users can insert own anime comments" on animefinder.anime_comments
for insert to authenticated with check (animefinder.is_authorized_user() and auth.uid() = user_id);
drop policy if exists "AnimeFinder users can update own anime comments" on animefinder.anime_comments;
create policy "AnimeFinder users can update own anime comments" on animefinder.anime_comments
for update to authenticated using (animefinder.is_authorized_user() and auth.uid() = user_id)
with check (animefinder.is_authorized_user() and auth.uid() = user_id);
drop policy if exists "AnimeFinder users can delete own anime comments" on animefinder.anime_comments;
create policy "AnimeFinder users can delete own anime comments" on animefinder.anime_comments
for delete to authenticated using (animefinder.is_authorized_user() and auth.uid() = user_id);
grant select, insert, update, delete on animefinder.anime_comments to authenticated;

-- =====================================================
-- 2) Persist the external anime metadata used by BOTH normal and master tables
-- =====================================================
alter table animefinder.personal_work_external_metadata add column if not exists mal_score numeric(4,2);
alter table animefinder.personal_work_external_metadata add column if not exists title_default text;
alter table animefinder.personal_work_external_metadata add column if not exists title_english text;
alter table animefinder.personal_work_external_metadata add column if not exists title_japanese text;
alter table animefinder.personal_work_external_metadata add column if not exists poster_url text;
alter table animefinder.personal_work_external_metadata add column if not exists year integer;
alter table animefinder.personal_work_external_metadata add column if not exists media_type text;
alter table animefinder.personal_work_external_metadata add column if not exists episodes integer;
alter table animefinder.personal_work_external_metadata add column if not exists anime_status text;
alter table animefinder.personal_work_external_metadata add column if not exists studio text;
alter table animefinder.personal_work_external_metadata add column if not exists source_type text;

-- =====================================================
-- 3) Write-through metadata RPC with ownership validation
-- =====================================================
create or replace function animefinder.save_work_external_metadata(
  p_work_id text,
  p_mal_id bigint,
  p_genres text[],
  p_provider text,
  p_mal_score numeric,
  p_title_default text,
  p_title_english text,
  p_title_japanese text,
  p_poster_url text,
  p_year integer,
  p_media_type text,
  p_episodes integer,
  p_anime_status text,
  p_studio text,
  p_source_type text
)
returns void
language plpgsql
security invoker
set search_path = animefinder, public
as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not animefinder.is_authorized_user() then raise exception 'Unauthorized'; end if;
  if not exists(select 1 from animefinder.personal_catalog_works w where w.user_id = uid and w.id = p_work_id) then
    raise exception 'Personal Work not found';
  end if;
  insert into animefinder.personal_work_external_metadata(
    user_id, personal_work_id, mal_id, genres, metadata_provider, metadata_fetched_at, updated_at,
    mal_score, title_default, title_english, title_japanese, poster_url, year, media_type,
    episodes, anime_status, studio, source_type
  ) values (
    uid, p_work_id, p_mal_id, coalesce(p_genres,'{}'), p_provider, now(), now(),
    p_mal_score, p_title_default, p_title_english, p_title_japanese, p_poster_url, p_year,
    p_media_type, p_episodes, p_anime_status, p_studio, p_source_type
  )
  on conflict (user_id, personal_work_id) do update set
    mal_id = excluded.mal_id,
    genres = excluded.genres,
    metadata_provider = excluded.metadata_provider,
    metadata_fetched_at = excluded.metadata_fetched_at,
    updated_at = now(),
    mal_score = coalesce(excluded.mal_score, animefinder.personal_work_external_metadata.mal_score),
    title_default = coalesce(excluded.title_default, animefinder.personal_work_external_metadata.title_default),
    title_english = coalesce(excluded.title_english, animefinder.personal_work_external_metadata.title_english),
    title_japanese = coalesce(excluded.title_japanese, animefinder.personal_work_external_metadata.title_japanese),
    poster_url = coalesce(excluded.poster_url, animefinder.personal_work_external_metadata.poster_url),
    year = coalesce(excluded.year, animefinder.personal_work_external_metadata.year),
    media_type = coalesce(excluded.media_type, animefinder.personal_work_external_metadata.media_type),
    episodes = coalesce(excluded.episodes, animefinder.personal_work_external_metadata.episodes),
    anime_status = coalesce(excluded.anime_status, animefinder.personal_work_external_metadata.anime_status),
    studio = coalesce(excluded.studio, animefinder.personal_work_external_metadata.studio),
    source_type = coalesce(excluded.source_type, animefinder.personal_work_external_metadata.source_type);
end;
$$;
grant execute on function animefinder.save_work_external_metadata(text,bigint,text[],text,numeric,text,text,text,text,integer,text,integer,text,text,text) to authenticated;

-- =====================================================
-- 4) Replace Master RPC so all runtime projections come from Supabase.
--    personal_catalog_works is always the left/base relation.
-- =====================================================
create or replace function animefinder.get_master_data_snapshot()
returns jsonb
language sql
security invoker
set search_path = animefinder, public
as $$
with work_rows as (
  select
    w.id, w.display_name, w.primary_mal_id, w.category, w.watch_status, w.my_ranked,
    w.original_observations, w.comments as catalog_comments, w.poster_url, w.mal_score,
    w.english_name, w.original_name, w.mal_url, w.association_mal_ids,
    coalesce((select v.content from animefinder.personal_work_comment_versions v
      where v.user_id=w.user_id and v.personal_work_id=w.id
      order by v.version_number desc, v.created_at desc limit 1), w.comments, '') current_comment,
    coalesce((select jsonb_agg(k.keyword order by k.rank,k.keyword)
      from animefinder.personal_work_keywords k where k.user_id=w.user_id and k.personal_work_id=w.id and k.confirmed), '[]'::jsonb) work_keywords,
    coalesce(meta.genres,'{}') genres,
    meta.metadata_provider, meta.metadata_fetched_at,
    coalesce(meta.mal_score,w.mal_score) persisted_mal_score,
    coalesce(meta.title_english,w.english_name) persisted_english_name,
    coalesce(meta.title_japanese,w.original_name) persisted_original_name,
    coalesce(meta.poster_url,w.poster_url) persisted_poster_url,
    meta.year, meta.media_type, meta.episodes, meta.anime_status, meta.studio, meta.source_type,
    syn.synopsis_original, syn.synopsis_pt_br, syn.synopsis_source, syn.synopsis_source_language,
    syn.synopsis_fetched_at, syn.synopsis_translated_at, syn.status synopsis_status, syn.last_error synopsis_last_error,
    coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'rank',c.rank,'name',c.character_name,
      'comment',coalesce((select cc.content from animefinder.personal_character_comments cc
        where cc.user_id=c.user_id and cc.personal_work_id=c.personal_work_id and cc.character_id=c.id
        order by cc.version_number desc,cc.created_at desc limit 1),''),
      'keywords',coalesce((select jsonb_agg(ck.keyword order by ck.rank,ck.keyword)
        from animefinder.personal_character_keywords ck where ck.user_id=c.user_id and ck.personal_work_id=c.personal_work_id and ck.character_id=c.id and ck.confirmed),'[]'::jsonb),
      'externalSources',coalesce((select jsonb_object_agg(es.provider,jsonb_build_object(
        'externalId',es.external_id,'canonicalName',es.canonical_name,'url',es.url,'imageUrl',es.image_url,
        'metadata',es.metadata_json,'confirmed',es.confirmed,'lastSyncedAt',es.last_synced_at))
        from animefinder.personal_character_external_sources es where es.user_id=c.user_id and es.personal_work_id=c.personal_work_id and es.personal_character_id=c.id and es.confirmed),'{}'::jsonb)
    ) order by c.rank,c.character_name) from animefinder.personal_work_characters c
      where c.user_id=w.user_id and c.personal_work_id=w.id and c.confirmed),'[]'::jsonb) character_knowledge
  from animefinder.personal_catalog_works w
  left join animefinder.personal_work_external_metadata meta on meta.user_id=w.user_id and meta.personal_work_id=w.id
  left join animefinder.personal_work_synopsis syn on syn.user_id=w.user_id and syn.personal_work_id=w.id
  where w.user_id=auth.uid()
), category_counts as (
  select category,count(*)::integer count from work_rows group by category
)
select jsonb_build_object(
  'source','supabase','generatedAt',now(),'totalWorks',(select count(*)::integer from work_rows),
  'categoryCounts',coalesce((select jsonb_object_agg(category,count) from category_counts),'{}'::jsonb),
  'works',coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'displayName',r.display_name,'primaryMalId',r.primary_mal_id,'category',r.category,
    'watchStatus',r.watch_status,'myRanked',r.my_ranked,'originalObservations',r.original_observations,
    'comment',r.current_comment,'posterUrl',r.persisted_poster_url,'malScore',r.persisted_mal_score,
    'englishName',r.persisted_english_name,'originalName',r.persisted_original_name,'malUrl',r.mal_url,
    'associationMalIds',to_jsonb(r.association_mal_ids),'keywords',r.work_keywords,'genres',to_jsonb(r.genres),
    'metadataProvider',r.metadata_provider,'metadataFetchedAt',r.metadata_fetched_at,
    'externalMetadata',jsonb_build_object('year',r.year,'type',r.media_type,'episodes',r.episodes,'status',r.anime_status,'studio',r.studio,'source',r.source_type),
    'synopsis',jsonb_build_object('original',r.synopsis_original,'ptBR',r.synopsis_pt_br,'provider',r.synopsis_source,
      'sourceLanguage',r.synopsis_source_language,'fetchedAt',r.synopsis_fetched_at,'translatedAt',r.synopsis_translated_at,
      'status',r.synopsis_status,'lastError',r.synopsis_last_error),
    'characterKnowledge',r.character_knowledge,
    'audit',jsonb_build_object(
      'hasMalId',r.primary_mal_id is not null,'hasGenres',cardinality(r.genres)>0,
      'hasSynopsisOriginal',nullif(trim(coalesce(r.synopsis_original,'')),'') is not null,
      'hasSynopsisPtBr',nullif(trim(coalesce(r.synopsis_pt_br,'')),'') is not null,
      'hasPersonalComment',nullif(trim(coalesce(r.current_comment,'')),'') is not null,
      'hasKeywords',jsonb_array_length(r.work_keywords)>0,'hasCharacters',jsonb_array_length(r.character_knowledge)>0,
      'hasCharacterExternalLinks',exists(select 1 from animefinder.personal_work_characters ec join animefinder.personal_character_external_sources ees
        on ees.user_id=ec.user_id and ees.personal_work_id=ec.personal_work_id and ees.personal_character_id=ec.id and ees.confirmed
        where ec.user_id=auth.uid() and ec.personal_work_id=r.id and ec.confirmed)
    )
  ) order by r.category,r.my_ranked nulls last,r.display_name) from work_rows r),'[]'::jsonb)
);
$$;
grant execute on function animefinder.get_master_data_snapshot() to authenticated;

-- =====================================================
-- 5) Database-only integrity report for diagnostics/final verification
-- =====================================================
create or replace function animefinder.get_data_integrity_report()
returns jsonb
language sql
security invoker
set search_path = animefinder, public
as $$
select jsonb_build_object(
  'totalWorks',(select count(*) from animefinder.personal_catalog_works where user_id=auth.uid()),
  'categoryCounts',coalesce((select jsonb_object_agg(category,cnt) from (
    select category,count(*) cnt from animefinder.personal_catalog_works where user_id=auth.uid() group by category
  ) q),'{}'::jsonb),
  'worksWithMalId',(select count(*) from animefinder.personal_catalog_works where user_id=auth.uid() and primary_mal_id is not null),
  'worksWithGenres',(select count(*) from animefinder.personal_work_external_metadata where user_id=auth.uid() and cardinality(genres)>0),
  'synopsisOriginal',(select count(*) from animefinder.personal_work_synopsis where user_id=auth.uid() and nullif(trim(coalesce(synopsis_original,'')),'') is not null),
  'synopsisPtBr',(select count(*) from animefinder.personal_work_synopsis where user_id=auth.uid() and nullif(trim(coalesce(synopsis_pt_br,'')),'') is not null),
  'personalCharacters',(select count(*) from animefinder.personal_work_characters where user_id=auth.uid() and confirmed),
  'jikanLinks',(select count(*) from animefinder.personal_character_external_sources where user_id=auth.uid() and provider='jikan' and confirmed),
  'fandomLinks',(select count(*) from animefinder.personal_character_external_sources where user_id=auth.uid() and provider='fandom' and confirmed),
  'bothLinks',(select count(*) from (
    select personal_work_id,personal_character_id from animefinder.personal_character_external_sources
    where user_id=auth.uid() and confirmed group by personal_work_id,personal_character_id having count(distinct provider)>1
  ) z)
);
$$;
grant execute on function animefinder.get_data_integrity_report() to authenticated;

notify pgrst, 'reload schema';
