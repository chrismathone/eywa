-- 0336a — 영상 과제 있음/없음(video_homework, 0308a)은 그 보고서를 처음 쓴 선생님(created_by, 0172a)만 바꾼다 — DB 겹.
--
-- 배경(원장 2026-10-03 *"선생님으로 구분하면 되는거 아닌가"* · *"일어날 수 있는 크리티컬한 가능성에 대해 삼사중 방어가드"*):
-- 강사뷰 '영상 제출 현황'은 작성 계정으로 "내가 낸 숙제"를 가른다. 보고서는 학생 × 날짜 × 반 한 줄이라 그 반을 함께 맡는
-- 선생님도 같은 줄을 저장할 수 있는데, 다른 선생님이 영상 과제를 켜면 켠 사람 장부에 안 뜬다.
-- 앱이 이미 두 겹으로 막는다(화면 토글 잠금 · 저장 관문 `videoHomeworkKept`). 이 트리거는 앱이 못 막는 둘을 막는다:
--   ① 두 선생님이 같은 순간 처음 저장하는 경합 — 나중 upsert는 갱신으로 바뀌고, 앱의 사전 조회는 줄이 없던 때를 봤다.
--   ② 앱을 거치지 않는 직접 **갱신**(같은 지점 사용자가 REST로 고치는 것 — lesson_reports RLS는 지점 격리뿐이다).
--      ⚠️ 갱신만 지킨다 — 직접 새 줄을 넣거나 지우고 다시 넣는 것은 대상이 아니다(보고서 표 전체의 직접 쓰기 범위는 별도 과제).
--
-- 규칙: 로그인 사용자(auth.uid())의 갱신에서, 작성 계정이 있고 내가 아니면 video_homework는 **원래 값을 둔다**(거절하지 않는다 —
--   같은 줄의 다른 내용 저장은 그대로 통과. 앱 저장 관문과 같은 동작).
--   · auth.uid()가 없는 갱신(서버 관리 키 — 사무실 일괄 처리·연동 PC·운영 스크립트)은 대상이 아니다.
--   · 작성 계정이 빈 줄은 대상이 아니다(이번 저장이 작성 계정을 채운다 — 0172a 트리거).
-- ⚠️ video_submit_link(0328a)는 일부러 건드리지 않는다 — 칸이 없는 스키마에서 트리거가 갱신을 통째로 죽이지 않게
--    (지금은 쓰이지 않는 칸이다, REPORT_VIDEO_LINK_RETIRED).
-- 앱은 이 트리거에 기대지 않는다(#95 — 적용 전후 둘 다 같은 동작). 되돌리기는 이 파일에 적지 않는다(기억·스크립트에만).

create or replace function public.lesson_reports_keep_video_homework_owner()
returns trigger language plpgsql as $$
begin
  if old.created_by is not null
     and auth.uid() is not null
     and auth.uid() <> old.created_by
     and new.video_homework is distinct from old.video_homework then
    new.video_homework := old.video_homework;
  end if;
  return new;
end;
$$;

drop trigger if exists lesson_reports_keep_video_homework_owner_trg on public.lesson_reports;
create trigger lesson_reports_keep_video_homework_owner_trg
  before update of video_homework on public.lesson_reports
  for each row execute function public.lesson_reports_keep_video_homework_owner();
