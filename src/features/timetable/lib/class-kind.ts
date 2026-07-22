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

export type TimetableKind = "regular" | "special" | "all";

/** 기본값 = 정규(특강 제외). 파라미터가 없을 때의 화면 = 지금까지의 시간표. */
export const DEFAULT_TIMETABLE_KIND: TimetableKind = "regular";

/** 칩 라벨(한글) — raw 영문 키를 화면에 내보내지 않는다. */
export const TIMETABLE_KIND_LABEL: Record<TimetableKind, string> = {
  regular: "정규",
  special: "특강",
  all: "전체",
};

/** 칩 순서(고정) — 정규 → 특강 → 전체. */
export const TIMETABLE_KINDS: TimetableKind[] = ["regular", "special", "all"];

/** URL 파라미터 → 구분. 모르는 값·미지정은 기본(정규)으로 안전하게 떨어진다. */
export function parseTimetableKind(raw?: string | null): TimetableKind {
  return raw === "special" || raw === "all" ? raw : DEFAULT_TIMETABLE_KIND;
}

/** 이 슬롯이 현재 구분에 보여야 하는가. */
export function matchesTimetableKind(kind: TimetableKind, isSpecialLecture: boolean): boolean {
  if (kind === "all") return true;
  return kind === "special" ? isSpecialLecture : !isSpecialLecture;
}
