create table if not exists public.leet_track_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.leet_track_state enable row level security;

revoke all on table public.leet_track_state from anon;
grant select, insert, update, delete on table public.leet_track_state to authenticated;

drop policy if exists "Users can read their own LeetTrack state" on public.leet_track_state;
create policy "Users can read their own LeetTrack state"
on public.leet_track_state
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own LeetTrack state" on public.leet_track_state;
create policy "Users can insert their own LeetTrack state"
on public.leet_track_state
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own LeetTrack state" on public.leet_track_state;
create policy "Users can update their own LeetTrack state"
on public.leet_track_state
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own LeetTrack state" on public.leet_track_state;
create policy "Users can delete their own LeetTrack state"
on public.leet_track_state
for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.set_leet_track_state_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_leet_track_state_updated_at on public.leet_track_state;
create trigger set_leet_track_state_updated_at
before update on public.leet_track_state
for each row
execute function public.set_leet_track_state_updated_at();

create or replace function public.sync_leet_track_state(
  p_payload jsonb,
  p_client_updated_at timestamptz
)
returns public.leet_track_state
language plpgsql
security invoker
set search_path = ''
as $$
declare
  synced public.leet_track_state;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  insert into public.leet_track_state (user_id, payload, client_updated_at)
  values (auth.uid(), p_payload, p_client_updated_at)
  on conflict (user_id) do update
  set payload = excluded.payload,
      client_updated_at = excluded.client_updated_at
  where excluded.client_updated_at >= public.leet_track_state.client_updated_at;

  select * into synced
  from public.leet_track_state
  where user_id = auth.uid();

  return synced;
end;
$$;

revoke all on function public.sync_leet_track_state(jsonb, timestamptz) from public, anon;
grant execute on function public.sync_leet_track_state(jsonb, timestamptz) to authenticated;
