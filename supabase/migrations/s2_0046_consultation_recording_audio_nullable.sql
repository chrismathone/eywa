-- s2_0046_consultation_recording_audio_nullable.sql — 등록상담 녹음 원본 보존기간 정리가 매일 밤 실패하던 것 · 2026-11-11
--
-- 왜: 녹음 보존기간 cron(`/api/cron/recordings-retention`, 원장 2026-07-28 *90일* — 원본 오디오만 지우고 전사·AI 분석은 영구 보존)은
--     원본을 지운 뒤 행의 `audio_path`를 NULL로 비운다. 다른 세 표(회의록·원생상담·등록상담)는 NULL을 받는데
--     `consultation_recordings.audio_path`만 NOT NULL이라 그 단계가 23502로 실패했다(운영 로그 2026-11-10 17:00Z · 매일 재시도).
--     운영 2026-11-11 확인: 90일 지난 녹음 행 13건 — 원본은 이미 지워졌는데(같은 경로를 베껴 둔 상담 행 쪽이 먼저 지우고 비움)
--     녹음 행은 없는 파일을 가리킨 채 남아 있다. 전사·화자·분석은 그대로라 행을 지우면 안 된다(영구 보존).
--
-- 무엇: NOT NULL 하나만 푼다. 빈 문자열·표식 경로 같은 대안은 기존 `!!audio_path` 판정을 그대로 통과해 "원본 있음"으로 속는다(Codex 협의).
--   읽는 곳 점검(2026-11-11): 녹음 행 목록(enrollment queries)은 audio_path를 읽지 않는다 · 상담 행 미러 복사는 이미 NULL을 받는 칸에 쓴다 ·
--   전사 합본·웹훅·재대조 cron은 경로와 무관 · 상담 삭제의 원본 지우기는 NULL을 걸러낸다.
--   앱(같은 묶음): cron이 ① 녹음 행이 원본으로 가진 경로를 상담 행 쪽 정리에서 건너뛰고 ② 녹음 원본을 지우면 같은 경로의 상담 행도 비운다.
-- 옛 앱·새 앱 둘 다 돈다(#95): 이 SQL만 먼저 들어가면 옛 cron도 그날 밤 13건을 비운다(원본은 이미 없음 — Storage는 없는 파일 지우기를 오류로 보지 않는다).
-- 학원 비서 보기(`assistant.*`): 칸 이름·형식이 그대로라 막히지 않는다(질문 때 지문을 보고 스스로 다시 만든다).
--
-- 되돌리기: 비워진 행이 있으면 되돌릴 수 없다(NOT NULL을 다시 걸려면 그 행에 값이 있어야 한다) — 되돌릴 일이 생기면 앱 cron부터 되돌릴 것.

begin;
set local lock_timeout = '5s';

alter table public.consultation_recordings
  alter column audio_path drop not null;

comment on column public.consultation_recordings.audio_path is
  '녹음 원본 Storage 경로(consultation-recordings 버킷). NULL = 보존기간(90일)이 지나 원본만 지움 — 전사·화자·분석은 남는다(s2_0046).';

commit;
