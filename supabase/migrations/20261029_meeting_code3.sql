-- 벙 일련번호를 3자리로 (32글자 × 3자리 = 32,768개, 중복 없음)
-- 헷갈리는 글자(0 O 1 I)는 계속 뺀다. 기존 5자리 번호도 모두 3자리로 바꾼다.
create or replace function public.gen_meeting_code() returns text
language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
begin
  loop
    candidate := '';
    for i in 1..3 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.meetings where code = candidate);
  end loop;
  return candidate;
end;
$$;

do $$
declare r record;
begin
  for r in select id from public.meetings where length(code) <> 3 order by date, created_at loop
    update public.meetings set code = public.gen_meeting_code() where id = r.id;
  end loop;
end;
$$;
