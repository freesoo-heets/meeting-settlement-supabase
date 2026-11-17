-- Hide monthly supporter entries without deleting members, bot points, medals,
-- or the original event keys (preserving award history and duplicate protection).
alter table public.monthly_support_events
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text,
  add column if not exists deletion_reason text;

create or replace function public.get_monthly_support_summary(p_month text)
returns table(nickname text,support_count bigint,points_total bigint)
language sql stable security definer set search_path='' as $$
  select (array_agg(e.nickname order by e.created_at desc,e.id desc))[1] as nickname,
         count(*) as support_count,
         coalesce(sum(e.points_awarded),0)::bigint as points_total
  from public.monthly_support_events e
  where e.month_key = p_month
    and e.deleted_at is null
    and p_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  group by e.kakao_uid
  order by count(*) desc,sum(e.points_awarded) desc
$$;
revoke all on function public.get_monthly_support_summary(text) from public;
grant execute on function public.get_monthly_support_summary(text) to anon,authenticated;

create or replace function public.hide_monthly_support_member(
  p_month text,p_kakao_uid text,p_actor text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_removed integer;
begin
 if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or nullif(trim(p_kakao_uid),'') is null
    or nullif(trim(p_actor),'') is null then
   raise exception 'Invalid monthly support removal request';
 end if;
 perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended(p_month || ':' || p_kakao_uid,0)
 );
 update public.monthly_support_events
 set deleted_at=now(),deleted_by=trim(p_actor),
     deletion_reason='admin_manual_cleanup'
 where month_key=p_month and kakao_uid=p_kakao_uid and deleted_at is null;
 get diagnostics v_removed=row_count;
 return jsonb_build_object('removed',v_removed);
end $$;
revoke all on function public.hide_monthly_support_member(text,text,text)
from public,anon,authenticated;
grant execute on function public.hide_monthly_support_member(text,text,text)
to service_role;
