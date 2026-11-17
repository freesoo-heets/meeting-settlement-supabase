-- From the third monthly support onward, award 10,000P for every event with no limit.
alter table public.monthly_support_events drop constraint if exists monthly_support_events_support_number_check;
alter table public.monthly_support_events add constraint monthly_support_events_support_number_check check (support_number >= 1);
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
  v_points := case v_count when 0 then 5000 when 1 then 7500 else 10000 end;
  insert into public.monthly_support_events(event_key,kakao_uid,nickname,month_key,support_number,points_awarded,operator_name)
  values(p_event_key,p_kakao_uid,trim(p_nickname),v_month,v_count+1,v_points,p_operator);
  return jsonb_build_object('status','created','count',v_count+1,'points',v_points,'month',v_month);
end $$;
revoke all on function public.record_monthly_support(text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_monthly_support(text,text,text,text) to service_role;
