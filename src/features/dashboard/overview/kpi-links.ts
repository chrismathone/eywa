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
 * 원생 통계 화면의 한 칸(원장 2026-10-20 *"대시보드의 모든 상세를 해당 탭의 통계 페이지로"*) — 운영실 카드 머리 '상세'·KPI ↗가 연다.
 * 카드 몸통(그림·팝업)은 그대로 두고 '상세'만 통계로 간다(원장 *"상세를 누르면 통계, 그냥 카드를 누르면 팝업"*).
 * `view` = 재원생 추이를 무엇으로 나눠 열지(과목별 · 수강 구성) — 이번 방문만 고르고 저장하지 않는다.
 * 학년별·학교별 카드는 옛 학년·학교 값이 저장되지 않아 정확한 흐름이 없으므로 여기로 오지 않는다(원생목록 그대로).
 */
export type StudentStatsSection = "trend" | "courses" | "flow";
export function studentsStatsHref(section: StudentStatsSection, view?: "subject" | "mix"): string {
  return `/students/stats${view ? `?view=${view}` : ""}#${section}`;
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

/**
 * KPI '신규문의' ↗ — 신규 콜&상담 통계 보기의 **신규 문의 추이**를 이번 달 일별로(원장 2026-10-20 *"신규 문의 추이는 없네 신규 문의 상세에서
 * 그것도 추가"*). 오늘 칸 = 카드 숫자. 오늘 접수 목록(옛 목적지 `intakeDayHref`)은 그 카드 머리 링크로 남는다.
 * `from=dashboard` = 이 방문은 '마지막 보기'를 저장하지 않는다.
 */
export function intakeTrendHref(): string {
  return "/enrollment?view=stats&trend=day&from=dashboard#intake";
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

/** KPI '최근 결석'의 창 길이(일). */
export const RECENT_ABSENCE_DAYS = 7;

/**
 * KPI '최근 결석'의 창 = **어제까지 7일**(KST). 원장 2026-10-20 *"전일결석 -> 최근 결석 (최근 7일 반영)"* — 옛 '전일 결석'(어제 하루,
 * 원장 2026-09-12)을 넓혔다. 오늘은 넣지 않는다 — 수업 전·진행 중이면 결석을 아직 알 수 없다(옛 카드의 이유 그대로 · 운영실
 * '출결 미입력'의 어제까지 7일과 같은 창).
 * 🔑 카드 숫자·팝업 머리가 **이 한 값**을 쓴다(서버가 센 창을 `absent.from/to`로 함께 실어 보낸다).
 * ⚠️ 일일 브리핑 '어제 결석'은 그대로 어제 하루다(briefing.ts — 별개 표면).
 */
export function recentAbsenceRange(today: string): { from: string; to: string } {
  return { from: addDays(today, -RECENT_ABSENCE_DAYS), to: addDays(today, -1) };
}
