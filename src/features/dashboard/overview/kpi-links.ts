/**
 * 운영실 KPI ↗(목적지 창) 주소 — 카드 숫자와 **같은 집합**을 목적지 화면에 그대로 세우는 단일 소스.
 *
 * 🔑 원생목록은 URL에 없는 축을 **계정에 저장된 보기 설정**으로 채운다(학년·과목·담임·미수강 제외). 그래서
 *    카드와 같은 집합을 보이려면 모든 축을 **명시값**으로 적어야 한다(빠뜨리면 저장값이 끼어들어 숫자가 달라진다).
 * 🔑 `from=dashboard` = 이 방문은 보기 설정을 **저장하지 않는다** — 명시값(전체)이 사용자의 저장된 필터를 덮으면 안 된다.
 */
import { addDays } from "@/lib/date-kst";
import type { Program } from "@/features/students/program";

const STUDENT_AXES = "subject=all&grade=all&teacher=all&noenr=0&from=dashboard";

/** 재원생(전 과목·전 학년·전 담임·미수강 포함) — program을 주면 그 프로그램만(같은 programOf 규칙). */
export function studentsEnrolledHref(program?: Program): string {
  return `/students?status=enrolled&${STUDENT_AXES}${program ? `&program=${program}` : ""}`;
}

/** 그날 첫 수업 학생(첫 등원 + 새 과목) — 상태는 전체(첫 수업 학생의 상태를 가리지 않는다). */
export function studentsFirstClassHref(date: string): string {
  return `/students?first=${date}&status=all&${STUDENT_AXES}`;
}

/** 그 달 퇴원(시스템 정리 제외) — program을 주면 그 프로그램만(마지막 수강 반 기준). */
export function withdrawalsMonthHref(month: string, program?: Program): string {
  return `/withdrawals?range=month&month=${month}${program ? `&program=${program}` : ""}`;
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
