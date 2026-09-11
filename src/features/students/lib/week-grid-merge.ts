/**
 * 학생 주간 격자의 **세로 병합 키** — 순수(Vitest). `week-grid.ts`가 시간표와 같은 병합 엔진(`computeBlocks`)에
 * 이 키를 먹인다: 이을 수 있는 이웃 칸끼리만 같은 키(열마다 실행 번호)를 받게 해서, 엔진은 손대지 않는다.
 *
 * 🔴 옛 키는 **반(classId)만** 봤다 — 시간표 기본뷰의 키지만 거기선 칸이 담임 열 안에 있고 칸에 교시 담당을
 *    적지 않아 문제가 없다. 학생 탭 칸은 **그 교시의 담당·자리·방**을 적으므로(원장 2026-09-07) 반만 같다고
 *    이으면 둘째 교시가 통째로 가려진다(원장 2026-09-11 제보 — 실측 이도윤B PL1b 월: 14:20 Sam·606 + 15:00
 *    LAB·603 → 한 칸 "Sam 606"으로 LAB 증발 / 화: 14:20 LAB + 15:00 Anna → 한 칸 "LAB"으로 Anna 증발).
 * 그래서 두 조건을 **다** 만족할 때만 잇는다:
 *  ① 보이는 내용이 같다 — 반·담당·자리·방(`sameFace`).
 *  ② 시간이 이어진다 — 앞 수업 끝 ~ 뒤 수업 시작 사이에 교시표의 **어느 교시도 시작하지 않는다**(쉬는 시간뿐,
 *     `continuesInto`). '수업 있는 교시만' 행 모드에선 빈 행이 빠져 두 행이 붙어 보여도, 실제로 사이에 교시가
 *     있었으면 안 잇는다. 쉬는 시간만 낀 연속 교시(수학 18:10→18:20)는 종전대로 잇는다(기본뷰와 같은 모양).
 */

export type MergeFace = {
  classId: string;
  teacherName: string | null;
  seat: string | null;
  room: string | null;
  /** 그 칸 수업의 실제 시각 `HH:MM`. 종료를 모르면 null — 이을 근거가 없어 아래로 잇지 않는다. */
  startTime: string;
  endTime: string | null;
};

const toMin = (t: string): number => {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** 두 칸이 **같은 것을 보여 주는가** — 반·담당·자리·방. 하나라도 다르면 잇는 순간 한쪽이 가려진다. */
export function sameFace(a: MergeFace, b: MergeFace): boolean {
  return a.classId === b.classId && a.teacherName === b.teacherName && a.seat === b.seat && a.room === b.room;
}

/**
 * 앞 수업(끝 `prevEnd`) 다음에 뒤 수업(시작 `nextStart`)이 **바로 이어지는가** — 그 사이에 교시표의 어느 교시도
 * 시작하지 않으면 이어진 것이다(끝 = 시작이면 당연히 이어짐). 겹치면(뒤가 앞 끝보다 먼저 시작) 데이터 이상이라 안 잇는다.
 */
export function continuesInto(prevEnd: string | null, nextStart: string, periodStarts: readonly string[]): boolean {
  if (!prevEnd) return false;
  const from = toMin(prevEnd);
  const to = toMin(nextStart);
  if (to < from) return false;
  return !periodStarts.some((s) => {
    const m = toMin(s);
    return m >= from && m < to;
  });
}

/**
 * (행, 열) → 병합 키. 빈 칸은 ""(computeBlocks가 안 묶는다). 같은 열에서 위 칸과 이을 수 있으면 같은 번호,
 * 아니면 새 번호 — 가로 병합은 호출부가 끄므로(allowColMerge=false) 번호는 열 안에서만 뜻이 있다.
 */
export function mergeRunKeys(
  numRows: number,
  numCols: number,
  cellAt: (r: number, c: number) => MergeFace | null,
  periodStarts: readonly string[],
): (r: number, c: number) => string {
  const keys: string[][] = [];
  for (let c = 0; c < numCols; c++) {
    const col: string[] = [];
    let run = 0;
    let prev: MergeFace | null = null;
    for (let r = 0; r < numRows; r++) {
      const cell = cellAt(r, c);
      if (!cell) {
        col.push("");
        prev = null;
        continue;
      }
      if (!prev || !sameFace(prev, cell) || !continuesInto(prev.endTime, cell.startTime, periodStarts)) run += 1;
      col.push(`r${run}`);
      prev = cell;
    }
    keys.push(col);
  }
  return (r, c) => keys[c]?.[r] ?? "";
}
