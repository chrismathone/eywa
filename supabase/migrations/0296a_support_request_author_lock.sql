-- 0296a — 개선요청 작성자 잠금 표식(author_locked_at)
--
-- 원장(2026-09-28): 답이 달렸던 요청 영구 잠금 → *"그것도 잠궈"* — 처리상태가 한 번이라도 '접수'를 벗어난 요청도
-- 작성자가 다시 고칠 수 없게 한다(운영자가 '접수'로 되돌려도 잠금 유지).
--
-- 🔑 `author_locked_at` = 운영자가 처음 손댄 때(상태가 '접수'가 아니게 되거나 답변이 저장된 때). 한 번 찍히면 안 지워진다.
--    찍는 곳은 **트리거 한 곳**이다 — 앱 경로가 늘어도 빠지지 않게(#132와 같은 이유).
--    작성자 수정은 서버 액션이 `author_locked_at is null` 조건으로만 UPDATE 한다(레이스 차단).
--
-- ⚠️ 앱은 이 SQL 적용을 확인한 뒤에 배포한다([[#95]]).
set local statement_timeout = '60s';

alter table public.support_requests add column if not exists author_locked_at timestamptz;

create or replace function public.tg_support_request_author_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.author_locked_at is not null then
    new.author_locked_at := old.author_locked_at;
  elsif new.status <> 'received' or new.answered_by is not null or new.answer is not null then
    new.author_locked_at := coalesce(new.author_locked_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists support_requests_author_lock on public.support_requests;
create trigger support_requests_author_lock before insert or update on public.support_requests
  for each row execute function public.tg_support_request_author_lock();

-- 이미 처리가 시작된 요청은 지금 잠근다.
update public.support_requests
   set author_locked_at = coalesce(answered_at, updated_at)
 where author_locked_at is null
   and (status <> 'received' or answered_by is not null or answer is not null);
