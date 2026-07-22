-- 0131a — 학부모 공지(classnote_notices)에 이미지/파일 첨부
--
-- 배경: 교재요청서를 만든 강사가 학부모에게 보내는 알림장 글은 지금 **글자만** 나간다. 원장이 손으로 올릴 땐
-- 글 하나에 ① 멘트+교재 내용 ② 교재요청서 양식 이미지(학생마다 다름) ③ 교재 표지(선택, 전원 공통)가 같이 붙는다.
-- 그 형태를 그대로 재현하려면 공지 큐 행이 첨부를 실을 자리가 필요하다.
--
-- ⚠️ 첨부가 **두 군데**로 나뉜다(의도적):
--   · 전원 공통(교재 표지 등) = 이 컬럼 `classnote_notices.attachments`
--   · 학생별(요청서 PNG)     = 기존 `targets` jsonb 배열의 **각 원소 안 `attachments` 필드**(스키마 변경 없음)
--   워커는 타깃마다 "공통 + 그 타깃 것"을 합쳐 ClassNote에 올린다. 그래서 학생별 첨부를 이 컬럼에 넣으면
--   전원에게 남의 요청서가 가는 사고가 된다 — **공통만** 여기.
--
-- 형식: `[{ "path": "<tenant>/report-attachments/<uuid>.png", "name": "...", "size": 12345 }]`
--   (수업보고서 첨부(lesson_reports.attachments)와 **같은 형식·같은 버킷**을 재사용 — 새 버킷 없음.)
--
-- 소비: 워커가 `GET /api/internal/notice-attachments/{noticeId}`(x-eywa-internal)로 signed URL을 받아 kage 업로드.
-- 쓰기: sendOnescreenNotice(공통) / sendTextbookNotice(학생별) — 첨부 0건이면 이 컬럼을 아예 건드리지 않아
--       기존 공지 발송 동작은 완전히 동일하다(default '[]').
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

alter table public.classnote_notices
  add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.classnote_notices.attachments is
  '전원 공통 첨부 [{path,name,size}] (report-attachments 버킷). 학생별 첨부는 targets[].attachments에 들어간다.';
