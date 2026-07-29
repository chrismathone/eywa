// 일괄 입력 대상 계산 — 순수 함수(서버·DOM 무관, Vitest로 잠금).
//
// 원스크린 일괄 입력의 계약을 그대로 따른다:
//  · 대상 = **화면에 보이는 그 집합**(이 교시 카드의 로스터). 표시와 일괄 대상이 어긋나면
//    "화면엔 5명인데 8명에게 적용"이 된다.
//  · 🔴 **채우기 기능에 "값이 있어야 통과"하는 게이트를 넣지 말 것** — 정작 채우려던 빈 행이
//    전부 빠져 항상 0건이 되는 사고가 원스크린에서 실제로 났다(grid.ts 교훈).
//  · 읽기 전용 행(기록만 남은 historical·수강 대상 아님)은 제외 — 편집 자체가 막힌 행이다.

export type BulkRosterRow = {
  studentId: string;
  /** 이 교시의 수강 대상인가(아니면 입력 불가) */
  eligible: boolean;
  /** 현재 수강 대상은 아니지만 기록이 있어 표시되는 행(읽기 전용) */
  historical: boolean;
};

/** 편집 가능한 행만 — 일괄·개별 공통 전제. */
function editableRows(roster: BulkRosterRow[], canEdit: boolean): BulkRosterRow[] {
  if (!canEdit) return [];
  return roster.filter((r) => r.eligible && !r.historical);
}

/**
 * 일괄 출석 대상 = 편집 가능 + **아직 출결 기록이 없는** 학생.
 * 이미 기록된 학생(출석·결석·지각 등)은 건드리지 않는다 — 출석 쓰기는 비파괴 계약이고
 * (markPresentIfAbsent), 이미 있는 값을 덮으면 출석부 쪽 기록을 앗아간다.
 * 즉 이 일괄은 언제나 "빈 칸만 채우기"라 확인 다이얼로그가 필요 없다.
 */
export function planBulkAttendance(
  roster: BulkRosterRow[],
  attendance: Record<string, string>,
  date: string,
  opts: { canEdit: boolean; canMarkDate: boolean },
): string[] {
  if (!opts.canMarkDate) return [];
  return editableRows(roster, opts.canEdit)
    .filter((r) => !attendance[`${r.studentId}|${date}`])
    .map((r) => r.studentId);
}

/**
 * 일괄 상태 대상. `onlyEmpty`면 상태가 비어 있는 행만(이미 입력한 값 보존).
 * onlyEmpty=false는 **강사가 방금 고른 값**을 넣는 것이라 덮어쓰기가 기본이지만,
 * 덮일 값이 있으면 호출부가 확인을 받는다(planBulkStatus는 계산만 한다).
 */
export function planBulkStatus(
  roster: BulkRosterRow[],
  marks: Record<string, { status: string | null; progressNote: string | null }>,
  date: string,
  slotStart: string,
  opts: { canEdit: boolean; onlyEmpty: boolean },
): string[] {
  return editableRows(roster, opts.canEdit)
    .filter((r) => {
      if (!opts.onlyEmpty) return true;
      const cur = marks[`${r.studentId}|${date}|${slotStart}`]?.status ?? null;
      return cur === null || cur === "";
    })
    .map((r) => r.studentId);
}

/** 덮어쓰기로 사라질 값의 개수 — 확인 문구에 실수를 밝히기 위한 계산(침묵 금지). */
export function countStatusOverwrites(
  roster: BulkRosterRow[],
  marks: Record<string, { status: string | null; progressNote: string | null }>,
  date: string,
  slotStart: string,
  canEdit: boolean,
): number {
  return editableRows(roster, canEdit).filter((r) => {
    const cur = marks[`${r.studentId}|${date}|${slotStart}`]?.status ?? null;
    return cur !== null && cur !== "";
  }).length;
}
