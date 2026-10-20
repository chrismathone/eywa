-- 0385a — 원생 통계 '지난 기록' 월별 집계(원장 2026-10-20 *"'지난 기록' 카드 따로"* · *"부드럽지 않은곳도 대략적으로 이어붙일 데이터가 있는지"*).
--
-- 화면은 이 작은 표(지점 × 달 × 출처 한 줄)만 읽는다 — 메이크에듀 원자료(0384a, 수납 8만여 줄)나 청구 항목 jsonb를 화면이 훑지 않게
-- (반응속도 · B2). 무거운 계산은 넣을 때 한 번(메이크에듀 — 운영자 스크립트) · 밤마다 한 번(에이와 — 원생 매일 기록 cron)만 한다.
--   source = 'makeedu'  2020-01 ~ 2025-12 메이크에듀 수납·원생 + 2025-03 ~ 메이크에듀 월별 재원생 기록(월별입학퇴원통계)
--   source = 'aywa'     청구가 지점을 덮기 시작한 달(최근 36개월 안) ~ 이번 달 · 에이와 청구·원생·출석·수강(원생 매일 기록 cron이
--                       밤마다 **모든 달**을 다시 세고, 시작 달보다 앞의 옛 줄은 지운다 — `recordAywaHistory`)
-- data jsonb 칸(없는 값은 넣지 않는다 — 0과 '모름'을 가른다):
--   payingGeneral    그달 수업료 청구가 살아 있는 학생(EiE 아닌 수업 · 미납 포함 · 취소·환불 제외) — 2025-04는 납부일 기준(청구 방식이 바뀐 달)
--   payingEie        같은 기준의 EiE 수업 학생(수업명이 `[EiE]`로 시작 · 메이크에듀는 2025-05부터 — 그 전 EiE 수업료는 이 메이크에듀 밖에서
--                    청구됐다 · EiE 청구가 없는 지점은 싣지 않는다)
--   payingTotal      두 수업 중 하나라도(한 학생은 한 번)
--   newReal          그달 등록 중 수업을 시작한 학생(원장 2026-10-20 '수업을 시작한 등록만' — 그 뒤 살아 있는 수업료 청구 · 에이와는 출석이나
--                    7일 넘게 다닌 반 수업도 · 직전 두 달에 청구가 있던 학생은 등록일만 고쳐진 재원생이라 뺀다 · 판정 `startedRegistration`)
--   newRegistered    그달 등록 전부(병합·장부 정리만 남은 등록은 빼고 · 상담만 하고 자료로 등록된 사람은 포함 — 비교용)
--   enrolledRecord   메이크에듀가 달마다 남긴 재원생 수(2025-03 ~ · 상태가 재원인 원생 — 휴원·시작 전 포함)
--   estimated        추정으로 메운 칸 이름 목록(예: ["payingGeneral"])
-- 🔴 서버 전용(정책 0개 · 0374a·0376a·0377a·0381a·0384a와 같은 방식) — 화면은 권한 확인 뒤 관리 키 + tenant_id로 읽는다.
-- 배포 순서: 앱보다 먼저(#95). 되돌리기: 이 표를 지운다(원자료는 0384a에 그대로).

create table if not exists public.student_history_monthly (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  source text not null check (source in ('makeedu', 'aywa')),
  data jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (tenant_id, month, source)
);
comment on table public.student_history_monthly is '원생 통계 지난 기록 — 지점×달×출처 월별 집계(수업료가 청구된 학생·실제 신규·메이크에듀 재원생 기록). 화면은 이 표만 읽는다. 0385a.';

alter table public.student_history_monthly enable row level security;
revoke all on public.student_history_monthly from public, anon, authenticated;
grant all on public.student_history_monthly to service_role;
