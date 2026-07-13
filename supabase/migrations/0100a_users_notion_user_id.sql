-- 0100a: users.notion_user_id — Notion 사용자 매핑 외부키(nullable).
-- 직원 상세 '월간일정' 탭이 이 값으로 Notion 업무 DB(담당자=이 사용자)를 조회한다.
-- makeedu_id(0057a)/edutrix_student_id(0094a) 패턴. nullable text 추가라 rewrite 없음(짧은 메타락).
-- RLS는 users 테이블 레벨 tenant_isolation(0001a)이 이미 커버 — 신규 정책 불필요.

alter table users add column if not exists notion_user_id text;

comment on column public.users.notion_user_id is
  'Notion 사용자 ID 매핑(외부키) — 직원 상세 월간일정 탭이 Notion 업무 조회에 사용. nullable.';

-- 테넌트당 1:1 매핑(한 Notion 사용자 = 한 직원). 부분 유니크(drizzle 미표현 [[#15]]).
create unique index if not exists users_tenant_notion_user_id_key
  on public.users (tenant_id, notion_user_id)
  where notion_user_id is not null;
