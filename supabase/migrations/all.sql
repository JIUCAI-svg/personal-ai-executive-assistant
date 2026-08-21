create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assistant_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sleep_time time not null default '23:30',
  wake_time time not null default '08:00',
  quiet_hours_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'archived')),
  priority smallint not null default 3 check (priority between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  notes text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'deferred', 'cancelled')),
  priority smallint not null default 3 check (priority between 1 and 5),
  estimated_minutes integer check (estimated_minutes between 5 and 720),
  actual_minutes integer check (actual_minutes between 0 and 1440),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  kind text not null default 'task' check (kind in ('task', 'break', 'unavailable', 'buffer')),
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'assistant' check (mode in ('temporary', 'assistant', 'project', 'daily_planning')),
  project_id uuid references public.projects(id) on delete set null,
  memory_scope jsonb not null default '{}'::jsonb,
  save_full_conversation boolean not null default true,
  allow_memory_distillation boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  action_result jsonb,
  created_at timestamptz not null default now()
);

create table public.memory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  kind text not null check (kind in ('fact', 'preference', 'decision', 'project_update', 'life_event')),
  content text not null,
  source_message_id uuid references public.chat_messages(id) on delete set null,
  status text not null default 'pending_review' check (status in ('pending_review', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  review_date date not null,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, review_date)
);

create table public.assistant_action_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid references public.chat_threads(id) on delete set null,
  action jsonb not null,
  result jsonb,
  created_at timestamptz not null default now()
);

create index tasks_user_status_idx on public.tasks(user_id, status, due_at);
create index schedule_blocks_user_starts_idx on public.schedule_blocks(user_id, starts_at);
create index chat_messages_thread_created_idx on public.chat_messages(thread_id, created_at);
create index memory_items_user_status_idx on public.memory_items(user_id, status, updated_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger assistant_settings_updated_at before update on public.assistant_settings for each row execute function public.set_updated_at();
create trigger projects_updated_at before update on public.projects for each row execute function public.set_updated_at();
create trigger tasks_updated_at before update on public.tasks for each row execute function public.set_updated_at();
create trigger chat_threads_updated_at before update on public.chat_threads for each row execute function public.set_updated_at();
create trigger memory_items_updated_at before update on public.memory_items for each row execute function public.set_updated_at();
create trigger daily_reviews_updated_at before update on public.daily_reviews for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.assistant_settings enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.memory_items enable row level security;
alter table public.daily_reviews enable row level security;
alter table public.assistant_action_log enable row level security;

create policy "profiles_owned" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "assistant_settings_owned" on public.assistant_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects_owned" on public.projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks_owned" on public.tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "schedule_blocks_owned" on public.schedule_blocks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "chat_threads_owned" on public.chat_threads for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "chat_messages_owned" on public.chat_messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "memory_items_owned" on public.memory_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "daily_reviews_owned" on public.daily_reviews for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "assistant_action_log_owned" on public.assistant_action_log for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- First synchronization pass: keep the existing application state as one
-- user-owned snapshot. The application can later migrate individual entities
-- into the normalized tables from 001 without changing the current planner.
create table public.assistant_state_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger assistant_state_snapshots_updated_at
before update on public.assistant_state_snapshots
for each row execute function public.set_updated_at();

alter table public.assistant_state_snapshots enable row level security;

create policy "assistant_state_snapshots_owned"
on public.assistant_state_snapshots
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Compare-and-swap saves make a second device refresh and retry rather than
-- silently overwriting an update made by another device.
create or replace function public.save_assistant_state(
  p_state jsonb,
  p_expected_revision bigint
)
returns table(revision bigint, updated_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  saved_revision bigint;
  saved_updated_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if p_expected_revision < 0 then
    raise exception 'STATE_CONFLICT' using errcode = 'P0001';
  end if;

  if p_expected_revision <> 0 and not exists (
    select 1 from public.assistant_state_snapshots where user_id = auth.uid()
  ) then
    raise exception 'STATE_CONFLICT' using errcode = 'P0001';
  end if;

  insert into public.assistant_state_snapshots (user_id, state, revision)
  values (auth.uid(), p_state, 1)
  on conflict (user_id) do update
  set state = excluded.state,
      revision = public.assistant_state_snapshots.revision + 1,
      updated_at = now()
  where public.assistant_state_snapshots.revision = p_expected_revision
  returning public.assistant_state_snapshots.revision, public.assistant_state_snapshots.updated_at
  into saved_revision, saved_updated_at;

  if not found then
    raise exception 'STATE_CONFLICT' using errcode = 'P0001';
  end if;

  return query select saved_revision, saved_updated_at;
end;
$$;

revoke all on function public.save_assistant_state(jsonb, bigint) from public;
grant execute on function public.save_assistant_state(jsonb, bigint) to authenticated;

