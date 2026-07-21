-- 0129a — 강사별 교재요청 학부모 발송 멘트(개인 기본값)
--
-- 배경: 교재요청서를 만든 강사가 그대로 학부모에게 ClassNote 공지로 보낼 때, 앞에 붙일 개인 멘트를
-- 매번 다시 쓰지 않도록 "직전에 쓴 멘트"를 다음 발송의 기본값으로 되살린다(중간저장 느낌, 원장 지시).
-- null/빈값 = 저장한 멘트 없음 → 화면이 기본 템플릿(DEFAULT_TEXTBOOK_MENT)을 채운다.
--
-- ⚠️ 왜 브라우저 저장(localStorage/IndexedDB)이 아니라 DB인가: 학원은 PC를 공유해서 쓴다.
--    브라우저에 저장하면 **다른 강사의 멘트**가 그 자리에 뜬다 → 계정(users) 단위 저장이 유일한 정답.
--
-- 소비: prepareTextbookNotice(기본값 주입) / sendTextbookNotice(발송 성공 시 다음 기본값으로 저장).
-- 쓰기: saveMyTextbookMent(본인 행만 — admin client + (id, tenant_id) 스코프. 0104a report_notice_mode 선례).
-- RLS 무변경: 읽기는 본인 users 행 self-select(기존 정책), 쓰기는 service_role을 user.id로 좁혀 사용.
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

alter table public.users
  add column if not exists textbook_notice_ment text;

comment on column public.users.textbook_notice_ment is
  '교재요청 학부모 발송 시 강사 개인 멘트(마지막 사용값 = 다음 기본값). null=미설정(기본 템플릿 사용).';
