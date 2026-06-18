// 시간표 기본뷰 그리드 — 요일 그룹 순서 + 같은 반 인접 요일 가로 병합(colSpan) 계산. 순수 함수.
// ijw `Math/utils/gridUtils.ts`의 isSameClassNameSet 개념 이식. eywa는 같은 classId의 월·목 슬롯이
// 동일 students라 classId 집합 키로 병합한다(동명 다른 반 오병합 방지).
import type { DayOfWeek } from "./periods";

// 요일 그룹 순서 — 월·목 / 화·금 / 수 / 토·일(주말 끝). ijw 요일그룹 컬럼 순서.
export const DAY_GROUP_ORDER: DayOfWeek[] = ["mon", "thu", "tue", "fri", "wed", "sat", "sun"];

const DAY_GROUP: Record<DayOfWeek, string> = {
  mon: "A", thu: "A", // 월목
  tue: "B", fri: "B", // 화금
  wed: "C",
  sat: "D", sun: "D", // 주말
};

/** 요일이 속한 그룹(A=월목 / B=화금 / C=수 / D=주말). 병합은 같은 그룹 내에서만. */
export function dayGroupOf(d: DayOfWeek): string {
  return DAY_GROUP[d] ?? "Z";
}

/** 요일 배열을 그룹 순서(월목/화금/수/주말)로 정렬 — 같은 그룹이 인접해 colSpan 병합 가능. */
export function sortDaysByGroup(days: DayOfWeek[]): DayOfWeek[] {
  return [...days].sort((a, b) => DAY_GROUP_ORDER.indexOf(a) - DAY_GROUP_ORDER.indexOf(b));
}

/** 셀의 수업 식별키 — classId 집합(중복 제거·정렬). 같은 키 = 같은 반(들) = 병합 대상. 빈 셀은 "". */
export function cellClassKey(classIds: string[]): string {
  if (classIds.length === 0) return "";
  return [...new Set(classIds)].sort().join("|");
}

export type CellBlock = { rowSpan: number; colSpan: number };

/**
 * 2D 셀 병합 — 같은 key가 연속한 행/열을 직사각형 블록으로 묶는다(ijw getConsecutiveSpan/shouldSkipCell).
 * 반환 Map: `${r}:${c}` → 블록(anchor 셀만). 맵에 없는 (r,c)는 위/왼쪽 블록에 피복됨(렌더 스킵).
 * - key ""(빈 셀)은 병합 안 함(각자 단일 1×1).
 * - allowColMerge=false면 가로 병합 끔(주말: 토/일 요일 병합 안 함, 세로 시간 병합만).
 * 같은 반이 연속 교시(세로)·인접 요일(가로)에 걸치면 한 칸으로.
 */
export function computeBlocks(
  numRows: number,
  numCols: number,
  keyAt: (r: number, c: number) => string,
  allowColMerge = true,
): Map<string, CellBlock> {
  const covered: boolean[][] = Array.from({ length: numRows }, () => new Array<boolean>(numCols).fill(false));
  const blocks = new Map<string, CellBlock>();
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      if (covered[r]![c]) continue;
      const key = keyAt(r, c);
      if (key === "") {
        blocks.set(`${r}:${c}`, { rowSpan: 1, colSpan: 1 }); // 빈 셀 — 병합 안 함
        continue;
      }
      // 가로 확장(같은 key 인접 열)
      let colSpan = 1;
      if (allowColMerge) {
        while (
          c + colSpan < numCols &&
          !covered[r]![c + colSpan] &&
          keyAt(r, c + colSpan) === key
        ) {
          colSpan++;
        }
      }
      // 세로 확장(아래 행이 colSpan 폭 전체에서 같은 key일 때만)
      let rowSpan = 1;
      while (r + rowSpan < numRows) {
        let rowMatches = true;
        for (let cc = c; cc < c + colSpan; cc++) {
          if (covered[r + rowSpan]![cc] || keyAt(r + rowSpan, cc) !== key) {
            rowMatches = false;
            break;
          }
        }
        if (!rowMatches) break;
        rowSpan++;
      }
      // 블록 피복 표시
      for (let rr = r; rr < r + rowSpan; rr++) {
        for (let cc = c; cc < c + colSpan; cc++) covered[rr]![cc] = true;
      }
      blocks.set(`${r}:${c}`, { rowSpan, colSpan });
    }
  }
  return blocks;
}

export type MergeRun = { index: number; span: number };

/**
 * 한 교시 행에서 인접 요일 셀을 가로 병합(colSpan)할 구간 계산.
 * 병합 조건: ① 키 비어있지 않음 ② 인접 셀 키 동일(같은 반) ③ 같은 요일그룹(월목·화금만).
 * → 월·목에 같은 반이 있으면 한 칸으로. 빈 셀·다른 반·다른 그룹은 각자 칸.
 * 반환: 각 run의 시작 인덱스(days 기준)와 span. 전 컬럼을 빠짐없이 덮는다.
 */
export function mergeRuns(days: DayOfWeek[], keys: string[]): MergeRun[] {
  const runs: MergeRun[] = [];
  let i = 0;
  while (i < days.length) {
    let span = 1;
    while (
      i + span < days.length &&
      keys[i] !== "" &&
      keys[i + span] === keys[i] &&
      dayGroupOf(days[i + span]!) === dayGroupOf(days[i]!)
    ) {
      span++;
    }
    runs.push({ index: i, span });
    i += span;
  }
  return runs;
}
