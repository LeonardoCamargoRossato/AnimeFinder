-- AnimeFinder — AI Personal Knowledge V2
-- Run after supabase/ai-personal-knowledge-v1.sql.
-- Adds persistent character ranking while preserving all V1 data and version history.

alter table animefinder.personal_work_characters
  add column if not exists rank integer;

with ordered as (
  select
    user_id,
    personal_work_id,
    id,
    row_number() over (
      partition by user_id, personal_work_id
      order by created_at, id
    )::integer as inferred_rank
  from animefinder.personal_work_characters
)
update animefinder.personal_work_characters as target
set rank = ordered.inferred_rank
from ordered
where target.user_id = ordered.user_id
  and target.personal_work_id = ordered.personal_work_id
  and target.id = ordered.id
  and target.rank is null;

alter table animefinder.personal_work_characters
  alter column rank set default 1;

alter table animefinder.personal_work_characters
  alter column rank set not null;

create index if not exists personal_work_characters_rank_lookup
  on animefinder.personal_work_characters(user_id, personal_work_id, rank);

create or replace function animefinder.save_personal_knowledge_v1(
  p_work_id text,
  p_mal_id bigint,
  p_versions jsonb,
  p_keywords jsonb,
  p_characters jsonb
)
returns void
language plpgsql
security invoker
set search_path = animefinder, public
as $$
declare
  uid uuid := auth.uid();
  item jsonb;
  nested jsonb;
  character_key text;
begin
  if uid is null or not animefinder.is_authorized_user() then
    raise exception 'Unauthorized';
  end if;
  if p_work_id is null or length(trim(p_work_id)) = 0 then
    raise exception 'personal_work_id is required';
  end if;

  delete from animefinder.personal_work_comment_versions
  where user_id = uid and personal_work_id = p_work_id;

  for item in select * from jsonb_array_elements(coalesce(p_versions, '[]'::jsonb)) loop
    insert into animefinder.personal_work_comment_versions(
      user_id, personal_work_id, mal_id, version_number, content, source, created_at
    ) values (
      uid,
      p_work_id,
      p_mal_id,
      coalesce(nullif(item->>'versionNumber','')::integer, 1),
      coalesce(item->>'content',''),
      case when item->>'source' in ('manual','voice','ai_organized','restored') then item->>'source' else 'manual' end,
      coalesce(nullif(item->>'createdAt','')::timestamptz, now())
    );
  end loop;

  delete from animefinder.personal_work_keywords
  where user_id = uid and personal_work_id = p_work_id;

  for item in select * from jsonb_array_elements(coalesce(p_keywords, '[]'::jsonb)) loop
    insert into animefinder.personal_work_keywords(
      user_id, personal_work_id, keyword, rank, source, confirmed, confidence
    ) values (
      uid,
      p_work_id,
      item->>'label',
      coalesce(nullif(item->>'rank','')::integer, 1),
      case when item->>'source' = 'manual' then 'manual' else 'ai_suggested' end,
      coalesce(nullif(item->>'confirmed','')::boolean, false),
      nullif(item->>'confidence','')::numeric
    );
  end loop;

  delete from animefinder.personal_character_keywords
  where user_id = uid and personal_work_id = p_work_id;
  delete from animefinder.personal_character_comments
  where user_id = uid and personal_work_id = p_work_id;
  delete from animefinder.personal_work_characters
  where user_id = uid and personal_work_id = p_work_id;

  for item in select * from jsonb_array_elements(coalesce(p_characters, '[]'::jsonb)) loop
    character_key := coalesce(nullif(item->>'id',''), md5(coalesce(item->>'name','') || clock_timestamp()::text));

    insert into animefinder.personal_work_characters(
      id, user_id, personal_work_id, character_name, rank, source, confirmed, confidence, updated_at
    ) values (
      character_key,
      uid,
      p_work_id,
      item->>'name',
      coalesce(nullif(item->>'rank','')::integer, 1),
      case when item->>'source' = 'manual' then 'manual' else 'ai_suggested' end,
      coalesce(nullif(item->>'confirmed','')::boolean, false),
      nullif(item->>'confidence','')::numeric,
      now()
    );

    for nested in select * from jsonb_array_elements(coalesce(item->'commentVersions', '[]'::jsonb)) loop
      insert into animefinder.personal_character_comments(
        user_id, personal_work_id, character_id, version_number, content, source, created_at
      ) values (
        uid,
        p_work_id,
        character_key,
        coalesce(nullif(nested->>'versionNumber','')::integer, 1),
        coalesce(nested->>'content',''),
        case when nested->>'source' in ('manual','voice','ai_organized','restored') then nested->>'source' else 'manual' end,
        coalesce(nullif(nested->>'createdAt','')::timestamptz, now())
      );
    end loop;

    for nested in select * from jsonb_array_elements(coalesce(item->'keywords', '[]'::jsonb)) loop
      insert into animefinder.personal_character_keywords(
        user_id, personal_work_id, character_id, keyword, rank, source, confirmed, confidence
      ) values (
        uid,
        p_work_id,
        character_key,
        nested->>'label',
        coalesce(nullif(nested->>'rank','')::integer, 1),
        case when nested->>'source' = 'manual' then 'manual' else 'ai_suggested' end,
        coalesce(nullif(nested->>'confirmed','')::boolean, false),
        nullif(nested->>'confidence','')::numeric
      );
    end loop;
  end loop;
end;
$$;

grant execute on function animefinder.save_personal_knowledge_v1(text, bigint, jsonb, jsonb, jsonb)
to authenticated;
