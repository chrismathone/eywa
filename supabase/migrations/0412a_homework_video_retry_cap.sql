-- 영상 보관 재시도 상한 = 10번 (원장 2026-10-13 *"재시도 10번 넘어가면 하지마 그냥."*).
--
-- 연동 PC는 보관에 실패한 영상(student_homework_videos.status = 'failed')을 15분 뒤 다시 집는다(available_at). 상한이 없어서
-- 받을 수 없는 영상 하나(2025-11-18 ClassNote 영상 — 반 연결 없음)가 10/1부터 1,079번 다시 시도됐고, 그때마다 실행 로그에
-- '영상 보관 · 작업 실패'가 찍혔다(다른 영상은 정상 보관).
--
-- 규칙: 집은 횟수(attempts — 연동 PC가 집을 때마다 1씩 는다)가 10 이상인데 실패로 돌아오면 다음 시도 시각을 100년 뒤로 민다.
--   연동 PC는 `available_at <= now()`인 줄만 고르므로 더는 집지 않는다(연동 PC 프로그램은 바꾸지 않는다 — zip 교체 없음).
--   · 상태는 '실패' 그대로 남는다(지우지 않는다 — 무엇이 안 됐는지 보인다).
--   · 다시 시도하게 하려면: 그 줄의 attempts를 0으로, available_at을 now()로 되돌린다.
--   · 실패가 아닌 되돌림(잠시 미룸 · 대기)은 대상이 아니다.
--   ⚠️ 상한이 세는 것은 **집은 뒤 실패한** 횟수다(attempts는 집을 때만 는다). 집지 않고 실패로 돌리는 갈래 — 이 PC의 폴더·계정이 아닌 작업
--      (다른 PC 몫일 수 있다)과 계정이 멈춰 미루는 작업 — 은 이 PC의 시도가 아니라 세지 않는다. 처리 중에 프로그램이 죽어 10분 뒤 다시
--      집히는 반복도 실패로 끝나지 않아 여기서는 못 막는다(다음 zip에서 후보 쿼리에 attempts 상한을 넣을 일).
-- 이미 10번을 넘긴 실패 줄은 이 파일이 바로 멈춘다(맨 아래 한 문장).
begin;
create or replace function public.student_homework_videos_retry_cap()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status = 'failed' and new.attempts >= 10 then
    new.available_at := greatest(coalesce(new.available_at, now()), now() + interval '100 years');
  end if;
  return new;
end $$;
drop trigger if exists student_homework_videos_retry_cap_trg on public.student_homework_videos;
create trigger student_homework_videos_retry_cap_trg before insert or update on public.student_homework_videos
  for each row execute function public.student_homework_videos_retry_cap();
update public.student_homework_videos set available_at = available_at where status = 'failed' and attempts >= 10;
commit;
