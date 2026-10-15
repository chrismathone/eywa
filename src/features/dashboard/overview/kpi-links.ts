/**
 * 운영실 KPI ↗(목적지 창) 주소. 재원생 링크는 카드와 같은 학생 집합을 연다.
 * 퇴원·수업종료 KPI는 과목별로 세고 퇴원관리 목록은 퇴원생을 학생별로 묶어 보여 준다.
 *
 * 🔑 원생목록은 URL에 없는 축을 **계정에 저장된 보기 설정**으로 채운다(학년·과목·담임·미수강 제외). 그래서
 *    카드와 같은 집합을 보이려면 모든 축을 **명시값**으로 적어야 한다(빠뜨리면 저장값이 끼어들어 숫자가 달라진다).
 * 🔑 `from=dashboard` = 이 방문은 보기 설정을 **저장하지 않는다** — 명시값(전체)이 사용자의 저장된 필터를 덮으면 안 된다.
 */
import { addDays } from "@/lib/date-kst";
import type { Program } from "@/features/students/enrollment/program";
import { NO_SUBJECT, type StudentLevel, type StudentMixFilter } from "@/features/students/list-filter-values";

const STUDENT_AXES = "subject=all&grade=all&teacher=all&noenr=0&from=dashboard";

/** 재원생(전 과목·전 학년·전 담임·미수강 포함) — program을 주면 그 프로그램만(같은 programOf 규칙). */
export function studentsEnrolledHref(program?: Program): string {
  return `/students?status=enrolled&${STUDENT_AXES}${program ? `&program=${program}` : ""}`;
}

/**
 * '재원생 구성' 막대 한 조각(원장 2026-09-28 *"다른 막대그래프들도 전부 해당기능으로 배선"*) — 학교급 × 수강 구성.
 * 원생목록이 막대와 **같은 함수**(compositionStudentIds)로 거른다 → 막대 숫자 = 목록 건수.
 * 줄 전체(막대 하나)는 `mixes`에 막대에 서는 셋(영어만·동시수강·수학만)을 모두 적는다(줄 오른쪽 숫자 = 그 셋의 합).
 */
export function studentsCompositionHref(filter: { level?: StudentLevel; mixes: readonly StudentMixFilter[] }): string {
  const level = filter.level ? `&level=${filter.level}` : "";
  const mix = filter.mixes.length > 0 ? `&mix=${filter.mixes.join(",")}` : "";
  return `${studentsEnrolledHref()}${level}${mix}`;
}

/**
 * '재원생 구성'의 **미수강** 막대 → 원생목록 수강 과목 = 미수강(원장 2026-09-28). 판정은 막대와 같은 activeStudentIds.
 * 🔑 다른 축(학년·담임·미수강 제외)은 전부 명시값 — 과목만 '미수강'으로 바꾼다(STUDENT_AXES의 subject=all 자리).
 */
export function studentsUnenrolledHref(): string {
  return studentsEnrolledHref().replace("subject=all", `subject=${NO_SUBJECT}`);
}

/** 그날 첫 수업 학생(첫 등원 + 새 과목) — 상태는 전체(첫 수업 학생의 상태를 가리지 않는다). */
export function studentsFirstClassHref(date: string): string {
  return `/students?first=${date}&status=all&${STUDENT_AXES}`;
}

/**
 * 그 달 퇴원·과목 전체 종료(시스템 정리 제외) — program을 주면 그 프로그램만.
 * `type=all`로 퇴원관리에서도 두 유형을 함께 보여 준다.
 */
export function withdrawalsMonthHref(month: string, program?: Program): string {
  return `/withdrawals?type=all&range=month&month=${month}${program ? `&program=${program}` : ""}`;
}

/** 그날 접수된 콜&상담(목록 보기). */
export function intakeDayHref(date: string): string {
  return `/enrollment?view=table&received=${date}`;
}

/** 그날 결석 학생(출석부). */
export function absentDayHref(date: string): string {
  return `/attendance/${date}?status=absent`;
}

/**
 * 보강예정 카드의 ↗ — 시간표 **'보강' 탭**(구분=보강, 이번 주부터). 카드와 **같은 두 함수**(반 집합 `listMakeupScopeClasses` ·
 * 기간 조회 `getReservationsInRange`)로 그린다. 탭은 **주 × 과목** 격자라 카드(오늘부터 한 달 · 전 과목 · 지난 미이행 포함)의
 * 숫자는 탭을 주마다 넘기며 과목마다 본 합이다 — 그래서 ↗ 문구는 "주별로 보기"다(원장 2026-09-16 창 확대).
 */
export function makeupWeekHref(): string {
  return "/timetable?kind=makeup";
}

/**
 * KPI '결석학생'의 기준일 = **어제**(KST). 원장 2026-09-12: *"대시보드 결석학생은 어제 결석으로 해야지.
 * 오늘은 수업을 안하면 볼 수가 없잖아"* — 오늘 수업이 아직 없으면 오늘 결석은 알 수 없다.
 *
 * 🔑 카드 숫자·자세히 보기·↗가 **이 한 값**을 쓴다(서버가 조회한 날을 `absent.date`로 함께 실어 보낸다).
 *    일일 브리핑 '어제 결석'도 같은 날이다(briefing.ts가 `asOf`에 어제를 넣어 같은 판정 함수를 태운다).
 * 🔴 '직전 수업일'로 바꾸지 말 것 — 원장은 '어제'라고 했다. 주말·휴일 다음 날은 0명이 맞고, 화면은 날짜와
 *    요일을 함께 적어(`formatShortKoreanDate`) 그 사실을 그대로 보인다.
 */
export function absentKpiDate(today: string): string {
  return addDays(today, -1);
}
