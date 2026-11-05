-- s2_0027 — 원생 흐름 분석(상담 · 타임라인) 저장 표 (원장 2026-11-03)
--
-- 원장: "상담은 ai 분석으로 새 상담 올릴때마다 상담 분석 돌릴것. 전체 상담을 한번 돌리고 다음 상담부터는 새 상담을 이전 상담 분석에
--       합산시켜서 어떤 방향으로 상담이 흘러가고 있는지 알아볼 수 있게" · "타임라인도 비슷하게"
--
-- 학생 × 종류(consultations · timeline)마다 **마지막 분석 한 벌**을 둔다. 화면(연결 탐색 왼쪽 '흐름' 카드)은 이 표만 읽고
-- 페이지 로드로는 AI를 부르지 않는다. 갱신은 ① 상담 저장 뒤(after) ② 밤 배치(타임라인 · 변동 있는 학생만) ③ '다시 분석' 버튼.
-- 합산 = 이전 분석(summary) + covered_through 이후의 새 기록만 모델에 넘겨 새 summary를 받는다(첫 분석은 전체 기록).
--
-- 🔴 읽기·쓰기 정책을 두지 않는다 — 서버(service_role)만 읽고 쓴다(s2_0002 · s2_0003과 같은 규약: admin 클라이언트 + tenant_id 필터).
--    권한(원생상담 메뉴 · 강사는 자기 상담만이라 합산 분석은 보여주지 않는다)은 앱이 가른다.
-- 되돌리기 = drop table public.student_flow_insights;

create table if not exists public.student_flow_insights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  kind text not null check (kind in ('consultations', 'timeline')),
  -- { headline, direction, themes[], recentChange, watch[], nextSteps[], basis } — 모양은 앱 flow-insight.ts(zod)가 잠근다.
  summary jsonb not null,
  -- 이 분석이 반영한 마지막 기록 시점(다음 합산은 이 뒤의 기록만) · 반영한 기록 수.
  covered_through timestamptz,
  covered_count integer not null default 0,
  model text,
  reason text,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_flow_insights_unique unique (tenant_id, student_id, kind)
);

create index if not exists student_flow_insights_tenant_kind_idx on public.student_flow_insights (tenant_id, kind, covered_through);

alter table public.student_flow_insights enable row level security;
revoke all on table public.student_flow_insights from anon, authenticated;
