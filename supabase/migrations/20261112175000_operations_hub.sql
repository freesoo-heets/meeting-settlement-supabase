create table public.operations_hub_checks (
  check_id text primary key check (check_id in (
    'main', 'meetings', 'mobile', 'roles', 'pet-local', 'pet-bridge',
    'pet-rewards', 'tarot-reading', 'tarot-history', 'release'
  )),
  status text not null check (status in ('pending', 'running', 'blocked', 'passed')),
  note text not null default '' check (char_length(note) <= 500),
  updated_at timestamptz not null default now()
);

alter table public.operations_hub_checks enable row level security;
revoke all on public.operations_hub_checks from anon, authenticated;
grant select, insert (check_id, status, note), update (status, note)
  on public.operations_hub_checks to authenticated;

create policy "Operators can view hub checks"
  on public.operations_hub_checks for select to authenticated
  using ((select public.is_admin()));
create policy "Operators can add hub checks"
  on public.operations_hub_checks for insert to authenticated
  with check ((select public.is_admin()));
create policy "Operators can update hub checks"
  on public.operations_hub_checks for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create function public.set_operations_hub_check_time()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger operations_hub_check_time
before insert or update on public.operations_hub_checks
for each row execute function public.set_operations_hub_check_time();
