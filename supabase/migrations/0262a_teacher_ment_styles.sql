-- 0262a — 강사별 **멘트 말투 프로파일** (원장 2026-08-18 "강사별 말투 코퍼스"의 후속, 착수 2026-09-12)
--
-- 0214a가 `lesson_reports.ment_source`로 "직접 쓴 멘트"(manual)와 "자동작성 후 고친 멘트"(auto_edited)를
-- 3주째 모아 왔는데(실측 2026-09-12: manual 690 · auto_edited 265 · 강사 7명) 그걸 읽는 곳이 없었다.
-- 이 표는 그 코퍼스를 **강사 한 사람당 한 줄**로 접은 말투 지침이다 — 자동작성이 매번 코퍼스를 읽으면
-- 토큰·왕복이 늘어 반응속도(1순위)를 깎으니, 주 1회(cron) 접어 두고 생성 때는 이 한 덩어리만 프롬프트에 붙인다.
--
-- profile(jsonb) = { tone, sentence, length, phrases[], closing, caution } — 모양·검증은
--   src/features/onescreen/ment-style.ts 단일 소스(parseMentStyleProfile). 🔴 학생 이름·점수 같은 **내용**은
--   담지 않는다(만든 뒤 코드가 표본의 학생 이름으로 한 번 더 걸러 새면 저장하지 않는다).
-- corpus_hash = 표본 id 집합의 지문 — 같으면 AI를 다시 부르지 않는다(주간 cron이 변동 없는 강사에게 비용을 안 태운다).
-- built_by = 'cron' | 갱신을 누른 사람의 users.id.
--
-- 🔴 읽기·쓰기 정책을 두지 않는다 — 서버 액션·cron(service_role)만 읽고 쓴다([[#104]] 규약: admin 클라이언트 +
--    tenant_id 명시 필터). 정책이 0개인 것은 **의도적**이다([[#92]] "의도적 제외는 마이그레이션에 적는다").
-- 🔴 유니크에 WHERE를 붙이지 않는다([[#113]]).
-- ⚠️ 앱은 이 표가 **없어도 돌아간다**([[#95]]) — 자동작성은 프로파일 없이 종전 그대로, 학원설정 카드는
--    "아직 준비 중"이라고 말하고 갱신 버튼만 잠근다. 원스크린 첫 화면은 이 표를 읽지 않는다(자동작성을 누를 때만).
--
-- 롤백: drop table if exists public.teacher_ment_styles;
set local statement_timeout = '60s';

create table if not exists public.teacher_ment_styles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  teacher_id uuid not null references public.users(id) on delete cascade,
  profile jsonb not null,
  sample_count integer not null default 0,
  manual_count integer not null default 0,
  edited_count integer not null default 0,
  corpus_hash text not null,
  -- 표본 중 가장 최근 멘트의 작성 시각 — 화면이 "언제까지의 글로 만든 것인지"를 말한다.
  corpus_until timestamptz,
  model text,
  built_by text not null default 'cron',
  built_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.teacher_ment_styles is
  '강사별 멘트 말투 프로파일(강사당 1행). 0214a ment_source 코퍼스를 주 1회 접은 것 — 자동작성 프롬프트에 붙는다. 서버 액션·cron 전용(정책 0개 = 의도). 0262a';

create unique index if not exists teacher_ment_styles_teacher_uniq
  on public.teacher_ment_styles (tenant_id, teacher_id);

alter table public.teacher_ment_styles enable row level security;

notify pgrst, 'reload schema';
