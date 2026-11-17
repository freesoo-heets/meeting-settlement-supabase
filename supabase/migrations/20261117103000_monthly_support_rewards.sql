-- Applied to the operational Supabase project on 2026-11-17.
-- Keep this migration in GitHub for new environments.
create table if not exists public.monthly_support_events (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  kakao_uid text not null,
  nickname text not null,
  month_key text not null,
  support_number integer not null check (support_number between 1 and 3),
  points_awarded integer not null check (points_awarded in (5000,7500,10000)),
  operator_name text,
  created_at timestamptz not null default now(),
  unique(month_key,kakao_uid,support_number)
);
create index if not exists monthly_support_events_month_idx on public.monthly_support_events(month_key,created_at desc);
alter table public.monthly_support_events enable row level security;
drop policy if exists monthly_support_events_public_read on public.monthly_support_events;
create policy monthly_support_events_public_read on public.monthly_support_events for select to anon,authenticated using (true);
revoke insert,update,delete on public.monthly_support_events from anon,authenticated;
grant select on public.monthly_support_events to anon,authenticated;

create or replace function public.record_monthly_support(p_event_key text,p_kakao_uid text,p_nickname text,p_operator text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_month text := to_char(now() at time zone 'Asia/Seoul','YYYY-MM');
 v_existing public.monthly_support_events%rowtype;
 v_count integer;
 v_points integer;
begin
 if p_event_key is null or length(trim(p_event_key)) < 5
   or p_kakao_uid is null or length(trim(p_kakao_uid)) < 1
   or p_nickname is null or length(trim(p_nickname)) < 1 then
   raise exception 'Invalid support event';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_month || ':' || p_kakao_uid, 0));
 select * into v_existing from public.monthly_support_events where event_key=p_event_key;
 if found then
   return jsonb_build_object('status','duplicate','count',v_existing.support_number,'points',v_existing.points_awarded,'month',v_existing.month_key);
 end if;
 select count(*) into v_count from public.monthly_support_events where month_key=v_month and kakao_uid=p_kakao_uid;
 if v_count >= 3 then
   return jsonb_build_object('status','limit','count',v_count,'points',0,'month',v_month);
 end if;
 v_points := case v_count when 0 then 5000 when 1 then 7500 else 10000 end;
 insert into public.monthly_support_events(event_key,kakao_uid,nickname,month_key,support_number,points_awarded,operator_name)
 values(p_event_key,p_kakao_uid,trim(p_nickname),v_month,v_count+1,v_points,p_operator);
 return jsonb_build_object('status','created','count',v_count+1,'points',v_points,'month',v_month);
end $$;
revoke all on function public.record_monthly_support(text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_monthly_support(text,text,text,text) to service_role;
