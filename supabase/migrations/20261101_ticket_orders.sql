-- 🎫 사이트 티켓 구매 요청. 사이트 API 가 requested 로 넣고 → 봇이 점수를 빼고 티켓을 넣은 뒤 done (실패는 failed)
-- 쓰기는 사이트 API(서비스 키)와 봇만. 본인 주문은 화면에서 결과를 확인할 수 있게 읽기만 허용
create table if not exists public.ticket_orders (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.members(id),
  name          text not null,
  uid           text not null,
  count         integer not null check (count between 1 and 20),
  state         text not null default 'requested' check (state in ('requested', 'processing', 'done', 'failed')),
  reason        text,
  cost          integer,
  exp_after     integer,
  tickets_after integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ticket_orders_state_idx on public.ticket_orders (state, created_at);
create index if not exists ticket_orders_member_idx on public.ticket_orders (member_id, created_at desc);
alter table public.ticket_orders enable row level security;
drop policy if exists ticket_orders_select on public.ticket_orders;
create policy ticket_orders_select on public.ticket_orders
  for select to authenticated using (public.can_use_app());
