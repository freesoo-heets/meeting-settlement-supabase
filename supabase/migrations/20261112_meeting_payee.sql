-- 💸 정산 입금받는 사람 · 계좌 (모임마다)
--   pay_to: 입금받는 사람 (비어 있으면 벙주 host_member)
--   pay_account: 계좌 (선택. 카카오페이로 받는 사람은 비워 둔다) → 정산 글에 같이 나간다
-- 모임 수정 권한 그대로 따른다 (사이트 비용 정산 화면에서 고친다). 여러 번 실행해도 된다.
alter table public.meetings add column if not exists pay_to uuid references public.members(id) on delete set null;
alter table public.meetings add column if not exists pay_account text;
