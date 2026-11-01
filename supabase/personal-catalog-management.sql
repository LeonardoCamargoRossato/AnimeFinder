-- AnimeFinder Personal Catalog Management V0
-- Run once in Supabase SQL Editor to sync dynamic Personal Catalog edits across devices.

create table if not exists animefinder.personal_catalog_works (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  primary_mal_id bigint,
  category text not null check (category in ('watched','movies','manhua','dropped-unfinished','new-seasons-2026','needs-classification')),
  watch_status text not null default 'unknown' check (watch_status in ('watched','watching','unfinished','dropped','planned','unknown')),
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

create index if not exists personal_catalog_user_idx on animefinder.personal_catalog_works(user_id);
create index if not exists personal_catalog_primary_mal_idx on animefinder.personal_catalog_works(primary_mal_id);
create index if not exists personal_catalog_category_rank_idx on animefinder.personal_catalog_works(user_id, category, my_ranked);
create index if not exists personal_catalog_associations_gin_idx on animefinder.personal_catalog_works using gin(association_mal_ids);

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

create or replace function animefinder.save_personal_catalog_batch(p_works jsonb)
returns void
language plpgsql
security invoker
set search_path = animefinder, public
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  watched_count integer;
  min_rank integer;
  max_rank integer;
  distinct_rank_count integer;
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
      item->>'category', item->>'watch_status', nullif(item->>'my_ranked','')::integer,
      item->>'original_observations', item->>'comments', item->>'poster_url',
      nullif(item->>'mal_score','')::numeric, item->>'english_name', item->>'original_name', item->>'mal_url',
      coalesce(array(select jsonb_array_elements_text(coalesce(item->'association_mal_ids','[]'::jsonb))::bigint), '{}'), now()
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

  -- Validate that saved watched ranking overrides are contiguous when they exist.
  select count(*), min(my_ranked), max(my_ranked), count(distinct my_ranked)
    into watched_count, min_rank, max_rank, distinct_rank_count
  from animefinder.personal_catalog_works
  where user_id = uid and category = 'watched' and my_ranked is not null;

  if watched_count > 0 and (min_rank <> 1 or max_rank <> watched_count or distinct_rank_count <> watched_count) then
    raise exception 'Watched ranking must be contiguous and unique';
  end if;
end;
$$;

grant execute on function animefinder.save_personal_catalog_batch(jsonb) to authenticated;
