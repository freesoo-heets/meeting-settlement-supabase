-- Bot-only reply authorization: admin_helper.py verifies real Kakao chat context first.
-- Database independently resolves the sender's immutable Kakao UID to one site profile,
-- for author attribution; it does NOT grant this sender web feedback reviewer privileges.
-- Never expose this RPC to anon/authenticated; only an existing trusted bot service key may call it.
create or replace function public.jjinchin_feedback_bot_reply_registered_admin(
 p_kakao_uid text, p_receipt bigint, p_message_id text, p_content text
) returns text
language plpgsql security invoker
set search_path=public
as $$
declare
  actor uuid;
  actor_count integer;
  fid uuid;
  added uuid;
begin
  if p_kakao_uid is null or length(trim(p_kakao_uid)) not between 1 and 256 then
    return 'INVALID_SENDER';
  end if;
  if p_receipt is null or p_receipt < 1 then return 'INVALID_RECEIPT'; end if;
  if p_content is null or length(trim(p_content)) not between 1 and 4000 then return 'INVALID_CONTENT'; end if;
  if p_message_id is null or length(p_message_id) not between 1 and 256 then return 'INVALID_MESSAGE_ID'; end if;

  -- Profiles refer to a stable site member. Bot checks admin_helper.is_admin(chat=chat)
  -- before invoking this service-role-only function.
  select min(p.id::text)::uuid, count(distinct p.id)
  into actor, actor_count
  from public.member_kakao_ids k
  join public.profiles p on p.member_id=k.member_id
  where k.kakao_user_id=p_kakao_uid;
  if actor_count=0 then return 'ACCOUNT_NOT_LINKED'; end if;
  if actor_count<>1 then return 'ACCOUNT_AMBIGUOUS'; end if;

  select id into fid from public.jjinchin_feedback
  where receipt_no=p_receipt for update;
  if fid is null then return 'NOT_FOUND'; end if;

  if exists(select 1 from public.jjinchin_feedback_reply_history
            where source_message_id=p_message_id) then
    return 'ALREADY_PROCESSED';
  end if;
  insert into public.jjinchin_feedback_reply_history
    (feedback_id,content,replied_by,source,source_message_id)
  values (fid,trim(p_content),actor,'kakao',p_message_id)
  on conflict(source_message_id) do nothing returning id into added;
  if added is null then return 'ALREADY_PROCESSED'; end if;

  perform set_config('app.feedback_reply_source','kakao',true);
  insert into public.jjinchin_feedback_replies
    (feedback_id,content,replied_by,replied_at)
  values (fid,trim(p_content),actor,now())
  on conflict(feedback_id) do update
  set content=excluded.content,replied_by=excluded.replied_by,replied_at=excluded.replied_at;

  update public.jjinchin_feedback set status='answered',updated_at=now() where id=fid;
  return 'SAVED';
end;
$$;

revoke all on function public.jjinchin_feedback_bot_reply_registered_admin(text,bigint,text,text)
from public,anon,authenticated;
grant execute on function public.jjinchin_feedback_bot_reply_registered_admin(text,bigint,text,text)
to service_role;
