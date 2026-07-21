-- 0128a_send_calendar_sendable.sql (손수 alpha)
-- 0127a 월간 발송 달력 수정 — **분모(발송 대상)가 부풀어 정상 운영이 대량 미발송처럼 보이던 것**을 잡는다.
--
-- 무엇이 틀렸었나(적대 검증 2026-07-21, 확정 5건 + 실데이터 확인):
--   0127a는 `classnote_status`만 보고 버킷을 갈랐는데, **발송 대상이 아닌 행들이 DB에 status를 남기지 않는다**.
--   · 과목 opt-in 밖(injaewon은 math만) → saveAndQueueClassnote가 `status:"subject_off"`를 **반환만** 하고 컬럼은 null
--   · 결석 게이트 → 오히려 queued를 null로 되돌리고 `status:"absent"` 반환만(“DB엔 안 남음”)
--   · edutrix 이관분(source='edutrix_import') → eywa에서 **구조적으로 발송 불가**인데 status는 null
--   실데이터: classnote_status 분포가 success 12,455 / null 4,895 **둘뿐**이라 앱의 excluded 버킷이 통째로 죽어 있었다.
--   결과: 영어 강사는 달 요약이 "발송 0/250", 수학 반도 결석분 때문에 "8/10"이 영원히 안 채워졌다.
--
-- ⚠️ 1차 수정에서 한 번 더 틀렸다(실데이터로 교정): 게이트 밖 행을 분모에서 빼 봤더니 **전 강사 "0/0"**이 됐다 —
--   lesson_reports 17,350건 중 17,335건(99.9%)이 Edutrix 이관분이라 빼면 남는 게 없다. 이관분 success는
--   실제로 학부모에게 나간 건이므로 "발송"으로 세는 게 참이다. 그래서 최종 설계는 **두 숫자를 분리**한다:
--     · `발송 N/M`(사실) = 출처 무관, 학부모에게 나갔는가          ← sendable을 쓰지 않는다
--     · `보낼 수 있음 K`(행동) = 미발송 중 **이 sendable을 통과한 것만** ← 여기서만 쓴다
--   그래서 이 컬럼의 뜻은 "발송 대상"이 아니라 **"지금 발송 버튼을 누르면 실제로 나가는가"**다.
--
-- 판정 = **발송 콘솔과 같은 게이트를 재사용**(#77 "행동을 재촉하는 화면은 그 행동의 기존 게이트를 쓴다").
--   sendClassnoteForUnsent / detectUnsentReports가 쓰는 구조 조건을 그대로 SQL로 옮긴다:
--     ① source가 edutrix_import면 대상 아님   ② revoked_at 있으면 대상 아님
--     ③ 과목 opt-in 밖이면 대상 아님(p_subjects — 빈 배열=전 과목 허용 안 함이 아니라 '설정 없음'이라 전부 대상)
--     ④ 발송 허용 기한(too_old) 밖이면 대상 아님(p_min_date — isClassnoteAllowed와 같은 '전 달 1일' 경계를 앱이 계산해 넘김)
--   ⚠️ **결석은 여기서 판정하지 않는다.** 결석 차단 규칙(반별 최신 기록·같은 과목 전 반 결석일 때만·보강 예외)은
--   앱 순수 로직(getAbsenceBlockedKeys)에 있고, 그걸 SQL로 다시 짜면 게이트가 둘로 갈라져 또 다른 거짓말이 된다.
--   대신 결석분은 `unsent`로 남고, 화면이 "결석 등으로 대상이 아닐 수 있음"을 명시한다(과대 주장 금지).
--
-- 반환은 (날짜 × 상태 × 대상여부) group-by — 여전히 수십 행이라 절단 사정권 밖(B2).
-- security invoker + auth_tenant_id() 이중격리. ⚠️ drizzle journal 밖(손수 alpha) — pnpm db:alphas가 사전순 적용.

drop function if exists onescreen_send_calendar(text, date, date);

create or replace function onescreen_send_calendar(
  p_teacher_name text,
  p_from date,
  p_to date,
  p_subjects text[] default null,  -- 발송 허용 과목 키. null/빈 배열 = 과목 게이트 미설정(전부 대상)
  p_min_date date default null     -- 이 날짜 이전 보고서는 발송 불가(too_old). null = 기한 제한 없음
)
returns table (
  report_day date,
  status_key text,   -- classnote_status 원문(미발송 null은 빈 문자열로 정규화)
  sendable boolean,  -- **지금 누르면 실제로 나가는가**(위 ①~④ 통과). 분모가 아니라 '보낼 수 있음' 배지에만 쓴다
  cnt int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.report_date as report_day,
    coalesce(r.classnote_status, '') as status_key,
    (
      coalesce(r.source, '') <> 'edutrix_import'
      and r.revoked_at is null
      and (p_subjects is null or cardinality(p_subjects) = 0 or r.subject = any(p_subjects))
      and (p_min_date is null or r.report_date >= p_min_date)
    ) as sendable,
    count(*)::int as cnt
  from lesson_reports r
  where r.tenant_id = auth_tenant_id()
    and r.teacher_name = p_teacher_name
    and r.report_date between p_from and p_to
  group by 1, 2, 3
$$;
