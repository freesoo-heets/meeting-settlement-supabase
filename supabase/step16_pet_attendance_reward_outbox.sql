-- STEP 16-6: Meeting -> PET attendance reward outbox
-- PET 보상 요청을 먼저 기록한 뒤 전송하여 일시적인 PET 장애에도 재처리할 수 있게 한다.

create table if not exists public.pet_attendance_reward_outbox (
  id uuid primary key default gen_random_uuid(),

  meeting_id uuid not null
    references public.meetings(id) on delete cascade,

  member_id uuid not null
    references public.members(id) on delete cascade,

  attendance_created_at timestamptz not null,

  status text not null default 'pending'
    check (status in ('pending', 'completed')),

  attempt_count integer not null default 0
    check (attempt_count >= 0),

  last_attempt_at timestamptz,
  completed_at timestamptz,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(meeting_id, member_id)
);

create index if not exists pet_attendance_reward_outbox_status_idx
on public.pet_attendance_reward_outbox(status, created_at);

create index if not exists pet_attendance_reward_outbox_member_idx
on public.pet_attendance_reward_outbox(member_id);

alter table public.pet_attendance_reward_outbox enable row level security;

-- 이 테이블은 브라우저에서 직접 읽거나 수정하지 않는다.
-- service_role을 사용하는 서버 API만 접근한다.

revoke all
on table public.pet_attendance_reward_outbox
from anon, authenticated;

grant all
on table public.pet_attendance_reward_outbox
to service_role;

create or replace function public.set_pet_attendance_reward_outbox_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pet_attendance_reward_outbox_set_updated_at
on public.pet_attendance_reward_outbox;

create trigger pet_attendance_reward_outbox_set_updated_at
before update on public.pet_attendance_reward_outbox
for each row
execute function public.set_pet_attendance_reward_outbox_updated_at();

-- PET Outbox 전송 시도 횟수를 DB에서 원자적으로 증가시킨다.
create or replace function public.mark_pet_attendance_reward_attempt(
  p_outbox_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt_count integer;
begin
  update public.pet_attendance_reward_outbox
  set
    attempt_count = attempt_count + 1,
    last_attempt_at = now(),
    last_error = null
  where id = p_outbox_id
  returning attempt_count into v_attempt_count;

  if v_attempt_count is null then
    raise exception 'PET attendance reward outbox not found: %', p_outbox_id;
  end if;

  return v_attempt_count;
end;
$$;

revoke all
on function public.mark_pet_attendance_reward_attempt(uuid)
from public, anon, authenticated;

grant execute
on function public.mark_pet_attendance_reward_attempt(uuid)
to service_role;
