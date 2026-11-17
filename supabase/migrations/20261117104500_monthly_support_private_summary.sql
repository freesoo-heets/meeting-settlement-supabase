-- Keep public read endpoints limited to aggregated names/counts/points.
revoke select on public.monthly_support_events from anon,authenticated;
drop policy if exists monthly_support_events_public_read on public.monthly_support_events;
create or replace function public.get_monthly_support_summary(p_month text)
returns table(nickname text,support_count bigint,points_total bigint)
language sql stable security definer set search_path='' as $$
  select (array_agg(e.nickname order by e.created_at desc, e.id desc))[1] as nickname,
         count(*) as support_count,
         coalesce(sum(e.points_awarded),0)::bigint as points_total
  from public.monthly_support_events e
  where e.month_key=p_month and p_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
  group by e.kakao_uid
  order by count(*) desc,sum(e.points_awarded) desc
$$;
revoke all on function public.get_monthly_support_summary(text) from public;
grant execute on function public.get_monthly_support_summary(text) to anon,authenticated;
