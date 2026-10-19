-- 0375a — 지점·기능별 **AI 모델 선택**(운영 콘솔 'AI 모델' 탭) (원장 2026-10-19 *"super 관리자에 AI 모델 토글 넣어서 지점별로 ai모델 바꿀 수 있게"*)
--
-- 한 줄 = 한 지점의 한 AI 기능에 고른 모델. 줄이 없으면 코드 기본(src/lib/ai/model-pins.ts `FEATURE_MODELS` · 호출부 tier·provider).
-- feature = generateJSON `meta.feature`(예 'classnote_ment') · model = model-pins.ts `AI_MODEL_CHOICES`의 모델 id(예 'deepseek-flash').
-- 목록 밖의 값은 앱이 저장하지 않고, 들어 있어도 무시한다(= 코드 기본).
--
-- 쓰는 곳 = 운영 콘솔 서버 액션(setTenantAiModel — 슈퍼관리자 게이트 + super_admin_audit_logs 'set_ai_model').
-- 읽는 곳 = generateJSON(모든 AI 호출) · 운영 콘솔 학원 상세 'AI 모델' 탭 — 둘 다 service_role.
--
-- 🔴 읽기·쓰기 정책을 두지 않는다 — 서버(service_role)만 읽고 쓴다. 정책이 0개인 것은 **의도적**이다
--    ([[#92]] "의도적 제외는 마이그레이션에 적는다"). 지점 화면에는 이 설정이 보이지 않는다(운영자 설정은 지점 화면에 노출하지 않는다).
-- ⚠️ 앱은 이 표가 **없어도 돌아간다**([[#95]]) — 조회 실패 = 고른 것이 없음(코드 기본 모델). 운영 콘솔 탭은 표가 없다고 안내한다.
--    적용 순서 제약 없음.
set local statement_timeout = '60s';

create table if not exists public.tenant_ai_models (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature text not null check (feature ~ '^[a-z][a-z0-9_]{1,63}$'),
  model text not null check (model ~ '^[a-z0-9][a-z0-9.\-]{1,63}$'),
  updated_by uuid, -- 고른 운영자(super_admins id) — 외래키 없음: 운영자는 지점 직원 행(public.users)이 없을 수 있다(0356a와 같은 이유).
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature)
);

comment on table public.tenant_ai_models is
  '지점·기능별 AI 모델 선택(운영 콘솔). 줄 없음 = 코드 기본. 서버 전용(정책 0개 = 의도). 0375a';

alter table public.tenant_ai_models enable row level security;

notify pgrst, 'reload schema';
