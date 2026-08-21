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
