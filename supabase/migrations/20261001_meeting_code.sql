-- 벙 일련번호 (5자리, 중복 없음) — 카톡 !벙참여 9월 · !벙참여 [번호] [닉네임들] 에서 쓴다
-- 헷갈리는 글자(0 O 1 I)는 뺀다
create or replace function public.gen_meeting_code() returns text
language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
begin
  loop
    candidate := '';
    for i in 1..5 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.meetings where code = candidate);
  end loop;
  return candidate;
end;
$$;

alter table public.meetings add column if not exists code text;

-- 기존 벙에 번호 채우기
do $$
declare r record;
begin
  for r in select id from public.meetings where code is null loop
    update public.meetings set code = public.gen_meeting_code() where id = r.id;
  end loop;
end;
$$;

alter table public.meetings alter column code set default public.gen_meeting_code();
alter table public.meetings alter column code set not null;
create unique index if not exists meetings_code_key on public.meetings (code);
