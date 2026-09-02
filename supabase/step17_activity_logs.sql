-- Step 17: 변경 이력(activity logs)
-- Step 14/15가 적용된 상태에서 실행하세요.

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  actor_nickname text not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  description text not null,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_created_at_idx
on public.activity_logs(created_at desc);

create index if not exists activity_logs_actor_id_idx
on public.activity_logs(actor_id);

alter table public.activity_logs enable row level security;

drop policy if exists "activity logs authenticated select"
on public.activity_logs;

drop policy if exists "activity logs own insert"
on public.activity_logs;

create policy "activity logs authenticated select"
on public.activity_logs
for select
to authenticated
using (public.can_use_app());

create policy "activity logs own insert"
on public.activity_logs
for insert
to authenticated
with check (
  public.can_use_app()
  and actor_id = auth.uid()
);

revoke all on table public.activity_logs from anon;
grant select, insert on table public.activity_logs to authenticated;
