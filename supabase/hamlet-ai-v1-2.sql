-- AnimeFinder — Hamlet AI V1.2
-- Manual SQL Editor deployment script for persistent conversations.
-- Safe/idempotent: creates only the Hamlet V1.2 objects when missing.

create extension if not exists pgcrypto;
create schema if not exists animefinder;

grant usage on schema animefinder to authenticated, service_role;

create table if not exists animefinder.hamlet_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled Hamlet Conversation',
  description text not null default '',
  title_source text not null default 'pending' check (title_source in ('pending','ai','user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed_at timestamptz not null default now(),
  access_count integer not null default 1 check (access_count >= 0),
  preferred_provider text not null default 'gemini',
  preferred_model text not null default 'gemini-3.5-flash-lite',
  last_model_used text,
  status text not null default 'active' check (status in ('active','history','archived')),
  current_intent jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists animefinder.hamlet_messages (
  id uuid primary key,
  conversation_id uuid not null references animefinder.hamlet_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null check (length(trim(content)) > 0),
  created_at timestamptz not null default now(),
  model_used text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists animefinder.hamlet_recommendations (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references animefinder.hamlet_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  mal_id bigint not null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (conversation_id, mal_id)
);

create index if not exists hamlet_conversations_user_access_idx
  on animefinder.hamlet_conversations(user_id, last_accessed_at desc);
create index if not exists hamlet_conversations_user_status_idx
  on animefinder.hamlet_conversations(user_id, status, last_accessed_at desc);
create index if not exists hamlet_messages_conversation_created_idx
  on animefinder.hamlet_messages(conversation_id, created_at asc);
create index if not exists hamlet_recommendations_conversation_created_idx
  on animefinder.hamlet_recommendations(conversation_id, created_at asc);
create index if not exists hamlet_recommendations_mal_idx
  on animefinder.hamlet_recommendations(user_id, mal_id);

alter table animefinder.hamlet_conversations enable row level security;
alter table animefinder.hamlet_messages enable row level security;
alter table animefinder.hamlet_recommendations enable row level security;

drop policy if exists hamlet_conversations_owner_all on animefinder.hamlet_conversations;
create policy hamlet_conversations_owner_all on animefinder.hamlet_conversations
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists hamlet_messages_owner_all on animefinder.hamlet_messages;
create policy hamlet_messages_owner_all on animefinder.hamlet_messages
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists hamlet_recommendations_owner_all on animefinder.hamlet_recommendations;
create policy hamlet_recommendations_owner_all on animefinder.hamlet_recommendations
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on animefinder.hamlet_conversations to authenticated;
grant select, insert, update, delete on animefinder.hamlet_messages to authenticated;
grant select, insert, update, delete on animefinder.hamlet_recommendations to authenticated;

create or replace function animefinder.touch_hamlet_conversation(p_conversation_id uuid)
returns animefinder.hamlet_conversations
language plpgsql
security invoker
set search_path = animefinder, public
as $$
declare
  result animefinder.hamlet_conversations;
begin
  update animefinder.hamlet_conversations
     set last_accessed_at = now(),
         access_count = access_count + 1,
         updated_at = now(),
         status = 'active'
   where id = p_conversation_id
     and user_id = auth.uid()
  returning * into result;
  return result;
end;
$$;

grant execute on function animefinder.touch_hamlet_conversation(uuid) to authenticated;

notify pgrst, 'reload schema';

-- Post-deployment verification. The three values below must all be true.
select
  to_regclass('animefinder.hamlet_conversations') is not null as hamlet_conversations_ready,
  to_regclass('animefinder.hamlet_messages') is not null as hamlet_messages_ready,
  to_regclass('animefinder.hamlet_recommendations') is not null as hamlet_recommendations_ready;
