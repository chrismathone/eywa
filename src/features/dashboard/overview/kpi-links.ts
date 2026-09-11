/**
 * 운영실 KPI ↗(목적지 창) 주소 — 카드 숫자와 **같은 집합**을 목적지 화면에 그대로 세우는 단일 소스.
 *
 * 🔑 원생목록은 URL에 없는 축을 **계정에 저장된 보기 설정**으로 채운다(학년·과목·담임·미수강 제외). 그래서
 *    카드와 같은 집합을 보이려면 모든 축을 **명시값**으로 적어야 한다(빠뜨리면 저장값이 끼어들어 숫자가 달라진다).
 * 🔑 `from=dashboard` = 이 방문은 보기 설정을 **저장하지 않는다** — 명시값(전체)이 사용자의 저장된 필터를 덮으면 안 된다.
 */
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
