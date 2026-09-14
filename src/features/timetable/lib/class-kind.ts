/**
 * 시간표 **정규 / 특강 / 전체** 전환 — 순수(Vitest). IO 없음.
 *
 * 특강 = 방학 단기강좌라 정규 주간표에 섞이면 시야가 흐려진다(원장 요구 2026-07-22:
 * "그 토글로 만든 반만 따로 보는 시간표"). 그래서 **기본은 정규**(특강 제외)이고, 특강은 별도 칩으로 본다.
 *
 * ⚠️ "이 반이 특강인가"는 여기서 판정하지 않는다 — 서버 단일소스
 * [`isSpecialLecture()`](src/features/classes/special-lecture.ts)가 확정한 boolean(`ScheduleSlot.isSpecialLecture`)을
 * 받기만 한다. 화면에서 반 이름 매칭을 재구현하면 시간표와 급여 과정 분류가 갈린다.
 */

/**
 * `makeup` = **보강 탭**(원장 2026-09-14 *"보강 예약 학생들을 시간표에서 … '보강'탭이 추가되어서"*) — 슬롯(class_schedules)이
 * 아니라 **보강 예약**(0264a)을 그 주 요일 × 교시 칸에 그린다. 슬롯 필터로는 뜻이 없어 `matchesTimetableKind`는
 * 전체와 같이 통과시키고(과목 목록은 전 반에서 나온다), 화면은 페이지가 예약 격자로 갈아탄다.
 */
export type TimetableKind = "regular" | "special" | "all" | "makeup";

/** 기본값 = 정규(특강 제외). 파라미터가 없을 때의 화면 = 지금까지의 시간표. */
export const DEFAULT_TIMETABLE_KIND: TimetableKind = "regular";

/** 칩 라벨(한글) — raw 영문 키를 화면에 내보내지 않는다. */
export const TIMETABLE_KIND_LABEL: Record<TimetableKind, string> = {
  regular: "정규",
  special: "특강",
  all: "전체",
  makeup: "보강",
};

/** 칩 순서(고정) — 정규 → 특강 → 전체 → 보강. */
export const TIMETABLE_KINDS: TimetableKind[] = ["regular", "special", "all", "makeup"];

/** URL 파라미터 → 구분. 모르는 값·미지정은 기본(정규)으로 안전하게 떨어진다. */
export function parseTimetableKind(raw?: string | null): TimetableKind {
  return raw === "special" || raw === "all" || raw === "makeup" ? raw : DEFAULT_TIMETABLE_KIND;
}

/** 보강 탭인가 — 슬롯 격자 대신 예약 격자를 그리는 구분. */
export function isMakeupKind(kind: TimetableKind): boolean {
  return kind === "makeup";
}

/** 이 슬롯이 현재 구분에 보여야 하는가. 보강 탭은 슬롯을 거르지 않는다(전체와 같다 — 과목 목록의 재료). */
export function matchesTimetableKind(kind: TimetableKind, isSpecialLecture: boolean): boolean {
  if (kind === "all" || kind === "makeup") return true;
  return kind === "special" ? isSpecialLecture : !isSpecialLecture;
}
