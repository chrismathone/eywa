/**
 * 학원 비서 DB 지도 전체 = 표 설명(a~l · m~z) + 온톨로지 보기(onto_*). 보기 이름은 SQL(s2_0031)이 정한다 —
 * 설명이 없는 새 표도 비서는 읽는다(시스템 프롬프트의 '설명이 아직 없는 표' 줄). 설명을 빠짐없이 두는 것은 가드 시험 몫.
 */
import { TABLES_A } from "./tables-a";
import { TABLES_B } from "./tables-b";
import { TABLES_EXTRA } from "./tables-extra";
import type { AssistantTableDoc } from "./types";

export const ONTOLOGY_DOCS: readonly AssistantTableDoc[] = [
  {
    name: "onto_students",
    label: "원생(규칙)",
    ko: "원생 한 사람 한 줄 + 세는 규칙(병합·테스트·장부 정리 퇴원 판정)을 칸으로 미리 계산한 보기",
    notes:
      "원생 수·퇴원 수는 이 보기로 센다. counted=true만 집계(테스트 원생·중복 병합으로 흡수된 원생·수업 기록 없는 장부 정리 퇴원 제외). status_label = 예비·상담완료·재원·휴원·퇴원. exit_kind = real(실제 퇴원) · bookkeeping(장부 정리, 퇴원으로 안 셈 — counted=false) · system_bulk(시스템 일괄 처리 날짜 미상 — 월별 퇴원 추이에서 뺀다) · scheduled(퇴원 예정) · null(퇴원 아님). withdrawn_on = 퇴원일(날짜). 월별 퇴원 추이 = exit_kind='real' and counted로 withdrawn_on을 달로 묶는다.",
    columns: {
      counted: "집계에 넣는 원생인가",
      is_merged: "중복 병합으로 다른 원생에 흡수됨",
      merged_into: "흡수한 원생 id",
      has_ended_enrollment: "끝난 수강이 한 번이라도 있음(수업 기록이 있었는가)",
      exit_kind: "퇴원 종류(real·bookkeeping·system_bulk·scheduled)",
      withdrawn_on: "퇴원일",
    },
  },
  {
    name: "onto_enrollments",
    label: "수강(규칙)",
    ko: "수강(원생→반) + 반 이름·과목·지금 담임 + 오늘 명단·수업 대상 여부",
    notes:
      "반별·과목별 인원은 이 보기로 센다. on_roster_today = 오늘(한국 날짜) 반 명단에 있음(휴원 포함 · 반이동으로 끝난 수강은 이동일부터 빠짐 · 일반 종료는 종료일까지) · active_today = 오늘 수업 대상(명단 − 휴원). 한 원생이 여러 반을 들으니 학원 인원은 count(distinct student_id). makeup_pool_class = 보강용 반(정규 인원에서 빼는 것이 보통). 원생 규칙(counted)과 함께 쓰려면 onto_students와 student_id로 잇는다. 과거 날짜 D의 명단은 enrollments에서 같은 규칙(start_date ≤ D · 반이동이면 end_date > D · 아니면 end_date ≥ D)으로.",
    columns: { on_roster_today: "오늘 명단(휴원 포함)", active_today: "오늘 수업 대상(휴원 제외)", homeroom_teacher_id: "반의 지금 담임(users.id)", makeup_pool_class: "보강용 반" },
  },
  {
    name: "onto_attendance",
    label: "출결(정정 반영)",
    ko: "유효 출결만(정정 이력 중 최신 한 줄) — 출석률·결석 수는 이 보기로 센다",
    notes:
      "attendance_records는 정정을 새 줄로 쌓는다 — 이 보기는 학생·반·수업일·교시(slot_start)마다 recorded_at이 가장 늦은 한 줄만 남겼다(앱 effectiveAttendanceRecords와 같다). session_date = 수업 날짜. taught_by = 실제로 수업한 사람(담임 배정과 다를 수 있다). status 값의 뜻·출석률 공식은 attendance_records 설명을 본다.",
  },
  {
    name: "onto_class_teachers",
    label: "반 담당",
    ko: "반→강사 배정 — 담임(지금) · 교시 담당(기간) · 임시 위임(기간)",
    notes:
      "role = homeroom(담임 — 지금 값, 기간 없음) · scheduled(교시 담당 — valid_from~valid_to) · delegated(임시 위임 — 기간). 배정이지 실제 수업 증거가 아니다(실제 = onto_attendance.taught_by). 과거 시점 질문은 그 날짜가 기간 안인 배정만 본다. teacher_id = users.id.",
  },
];

export const ASSISTANT_DOCS: readonly AssistantTableDoc[] = [...ONTOLOGY_DOCS, ...TABLES_A, ...TABLES_B, ...TABLES_EXTRA];
