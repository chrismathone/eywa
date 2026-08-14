-- 0212a — 출결 입력 주체(recorded_via) + 데스크 교차알림 수신 토글.
-- (0211a는 휴가 RLS 수리 `0211a_leave_rls_recursion_fix`가 씀.)
--
-- 배경(원장 2026-08-14 추가): *"10분 이후 미출결건에 대하여 수정할때만. 이때는 구분해줄것.
-- 내부 데이터로. 미출결 -> 출결로 바뀌면 알림이 가도록, 단 데스크가 미출결 -> 출결하면 강사는
-- 모를 수도 있으니 강사에게 알림을, 반대로 미출결 -> 출결을 강사가 했다면 데스크에 알림을."*
--
-- 1. `attendance_records.recorded_via` — 쓰는 순간의 입력 주체.
--    역할은 변하므로 컬럼에 굳힌다(자리 출석부 `seat_label`과 같은 이유).
--    null = 이 컬럼 이전 기록이거나, 아직 못 채운 경로(ECS RPC 등). 거짓말은 하지 않는다.
--
-- 2. `users.desk_attendance_optin` — 강사가 미출결→출결로 바꾼 알림을 받을 데스크 계정.
--    ⚠️ `attendance_alert_optin`(학부모 연락·셔틀)을 재사용하지 않는다 — 뜻이 다르고 수신자가 섞인다.
--    선례: 그 컬럼(0184a), `users.seat_lab_duty`(0209a).
--
-- 앱은 컬럼이 없어도 안 죽는다(#95) — 쓰기는 컬럼 부재 시 빼고 재시도, 토글 조회는 실패 시 꺼짐.
-- 그래도 주체가 남고 토글이 켜지려면 이 SQL을 먼저 돌려야 한다.
--
-- 멱등: add column if not exists.
-- 롤백:
--   alter table attendance_records drop column if exists recorded_via;
--   alter table users drop column if exists desk_attendance_optin;
--   alter table attendance_records drop constraint if exists attendance_records_recorded_via_chk;

alter table attendance_records
  add column if not exists recorded_via text;

-- 이미 컬럼만 있고 제약이 없는 재실행을 위해 제약은 따로.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'attendance_records_recorded_via_chk'
  ) then
    alter table attendance_records
      add constraint attendance_records_recorded_via_chk
      check (recorded_via is null or recorded_via in ('teacher', 'desk', 'seat', 'kiosk'));
  end if;
end $$;

comment on column attendance_records.recorded_via is
  '입력 주체(teacher=강사 / desk=데스크 / seat=자리 / kiosk=키오스크). 쓰는 순간에 굳힘. null=미상(0212a 이전 또는 미배선 경로).';

alter table users
  add column if not exists desk_attendance_optin boolean not null default false;

comment on column users.desk_attendance_optin is
  '오늘 출결 데스크 알림. true면 강사가 미출결을 출석으로 바꾼 벨을 이 계정이 받는다(0212a). attendance_alert_optin(셔틀·학부모 연락)과 별개.';
