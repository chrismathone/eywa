-- 0226a: 어제 출결 요약의 **AI 정리** 저장소 (2026-08-19, 원장: "어제 출결을 요약해서 정리하는 기능 · 관리자용
-- · 팩트만을 가지고 · 필요하면 deepseek api 사용해서 정리할것").
--
-- ■ 이 표가 담는 것 / 안 담는 것
--   요약 탭의 **숫자·명단은 저장하지 않는다.** 그건 출결 원장(attendance_records)에서 매번 결정론으로
--   집계하는 것이 진실이고(digest.ts), 나중에 강사가 늦게 찍거나 데스크가 조치를 남기면 요약도 따라
--   바뀌어야 한다. 스냅샷을 떠 두면 그 순간 화면이 원장과 갈린다.
--   여기 남는 것은 **LLM이 쓴 정리 문장 한 벌**(summary)과 그 생성 상태뿐이다 — AI 호출은 캐싱 + 명시
--   트리거가 규칙이라(CLAUDE.md), 버튼을 다시 누르기 전까지 마지막 결과를 그대로 보여줄 자리가 필요하다.
--
-- ■ 상태 시멘틱
--   idle | analyzing | completed | failed.  'failed' + error(한글) = "집계는 멀쩡하고 AI 정리만 실패".
--   화면은 이 경우에도 결정론 집계를 그대로 그린다 — AI는 부가물이라 없어도 기능이 성립한다.
--
-- ■ RLS
--   ⚠️ 0114a daily_briefings와 같은 취지로 **정책을 만들지 않는다**(RLS는 켠다 = 전부 거부).
--   summary에는 전 학원 학생의 결석 사유·담당 강사가 문장으로 들어가므로, tenant-wide select 정책을
--   붙이면 브라우저 anon 키로 강사가 devtools 한 줄에 전문을 읽는다(#77 "UI 조건은 게이트가 아니다").
--   읽기·쓰기 전부 서버(service_role admin client)가 attendance full 게이트를 통과한 뒤 수행하고,
--   admin은 RLS를 우회하므로 **모든 쿼리에 tenant_id 필터를 명시**한다([[#104]]).
--
-- ⚠️ 앱은 이 표가 **없어도 돈다**(#95: 옛 스키마·새 스키마 둘 다에서 동작). 요약 탭의 집계·명단은
--    이 표를 전혀 읽지 않고, AI 카드만 조회 실패 시 '정리 없음'으로 조용히 접힌다.
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

create table if not exists attendance_day_recaps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  recap_date date not null,                  -- KST 기준 요약 대상 날짜(보통 어제) — UTC 날짜 사용 금지
  status text not null default 'idle',       -- idle | analyzing | completed | failed
  error text,                                -- 한글 사유(후검증 탈락·생성 실패). UI에 그대로 노출된다.
  summary jsonb,                             -- {headline, points[]} — validateRecapBrief 통과분만
  model_version text,                        -- 실사용 모델 id(친화적 라벨로 변환해 화면에 노출)
  requested_by uuid references users(id) on delete set null,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), -- analyzing 5분 고착 판정 기준(재클릭 우회)
  unique (tenant_id, recap_date)             -- 하루 한 행 = 클릭 경합의 유일한 방지선(23505로 안내)
);

create index if not exists attendance_day_recaps_tenant_date_idx
  on attendance_day_recaps (tenant_id, recap_date desc);

alter table attendance_day_recaps enable row level security;
-- 정책 없음(의도) — service_role만 통과. 위 헤더 주석 참조.

drop trigger if exists attendance_day_recaps_set_updated_at on attendance_day_recaps;
create trigger attendance_day_recaps_set_updated_at
  before update on attendance_day_recaps
  for each row execute function tg_set_updated_at();

comment on table attendance_day_recaps is
  '0226a 어제 출결 요약의 AI 정리 문장 저장소. 숫자·명단은 저장하지 않는다(매번 결정론 집계가 진실). RLS 정책 없음 = service_role 전용.';
