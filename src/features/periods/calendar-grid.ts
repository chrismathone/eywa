// 세션 편집 달력 격자 — 순수 함수(Vitest 강제).
//
// 원장이 올린 연간계획표(EIE 침산 / 초등 수학과) 그대로: 12개월을 한 판에 펼치고 세션 구간을 색으로 칠한다.
// 달마다 일~토 7열 × 6주 = **42칸 고정**(달마다 높이가 달라지면 눈이 표를 못 따라간다). 앞뒤 빈칸은
// 전월·차월 날짜로 채워 **세션이 달을 넘는 게 눈에 보이게** 한다 — 2월 세션이 3/5까지 가는 게 정상이므로
// 그 꼬리가 2월 달력 안에서 이어져 보여야 한다.
//
// 🔴 구 출석부(D:\attendance SessionSettingsModal)의 버그 셋을 여기서 구조적으로 막는다:
//   ① 드래그를 시작한 달력에 범위 전체가 귀속됐다 → 3월 달력의 후행 4월 칸에서 시작하면 4월을 칠했다고
//      믿는데 3월에 저장됐다. → 칸마다 **실제 날짜(iso)**를 들고 있고 라벨월은 호출부가 명시 결정한다.
//   ② 넘어간 구간이 다음 달 달력엔 안 칠해져 같은 날을 두 번 칠하게 됐다(겹침 직행).
//      → `paintedMonthOf`가 **날짜 기준**으로 어느 세션에 속하는지 알려주므로 어느 달력에서 보든 같은 색이다.
//   ③ 요약이 일(day)만 보여 끝 월을 알 수 없었다 → 여기선 항상 iso를 다룬다(표시 축약은 호출부).

export type GridCell = {
  /** "YYYY-MM-DD" — 이 칸의 진짜 날짜. 판정·칠하기는 전부 이걸로 한다. */
  iso: string;
  day: number;
  /** 0=일 … 6=토 */
  dow: number;
  /** 이 달력(labelMonth)에 속한 날인지. false면 전월·차월의 흐린 칸. */
  inMonth: boolean;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** 그 달 1일의 요일(0=일). UTC로 계산해 타임존 시프트를 없앤다. */
function firstDow(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * 한 달 달력 = 42칸(6주). 앞은 전월 꼬리, 뒤는 차월 머리로 채운다.
 * 달력이 5주로 끝나도 42칸을 유지한다 — 12판을 나란히 놓았을 때 줄이 맞아야 읽힌다.
 */
export function monthGrid(year: number, month: number): GridCell[] {
  const cells: GridCell[] = [];
  const lead = firstDow(year, month);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevLast = lastDay(prevYear, prevMonth);

  // 전월 꼬리
  for (let i = lead - 1; i >= 0; i--) {
    const d = prevLast - i;
    cells.push({
      iso: `${prevYear}-${pad(prevMonth)}-${pad(d)}`,
      day: d,
      dow: cells.length % 7,
      inMonth: false,
    });
  }
  // 이 달
  const last = lastDay(year, month);
  for (let d = 1; d <= last; d++) {
    cells.push({ iso: `${year}-${pad(month)}-${pad(d)}`, day: d, dow: cells.length % 7, inMonth: true });
  }
  // 차월 머리 — 42칸까지
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  let d = 1;
  while (cells.length < 42) {
    cells.push({
      iso: `${nextYear}-${pad(nextMonth)}-${pad(d)}`,
      day: d,
      dow: cells.length % 7,
      inMonth: false,
    });
    d++;
  }
  return cells;
}

export type PaintedRange = { labelMonth: number; start: string; end: string };

/**
 * 날짜가 어느 세션(라벨월)에 칠해졌는지 — 없으면 null.
 * ⚠️ **날짜 기준**이라 어느 달력에서 보든 같은 답이 나온다(구 버그 ②의 구조적 해결).
 */
export function paintedMonthOf(iso: string, ranges: readonly PaintedRange[]): number | null {
  for (const r of ranges) {
    if (r.start && r.end && iso >= r.start && iso <= r.end) return r.labelMonth;
  }
  return null;
}

/** 드래그 중 미리보기 구간(앵커~커서, 순서 무관). */
export function dragRange(anchor: string, cursor: string): { start: string; end: string } {
  return anchor <= cursor ? { start: anchor, end: cursor } : { start: cursor, end: anchor };
}

/**
 * 드래그로 칠한 구간의 **라벨월** — 기본은 시작일의 달이다.
 * 원장 규칙과 같다(2월 세션이 3/5에 끝나도 라벨은 2월). 구 출석부처럼 "드래그를 시작한 달력"에
 * 귀속시키지 않는다 — 3월 달력의 후행 4월 칸에서 끌기 시작하면 그건 4월 세션이다.
 *
 * 🔴 단, **해를 넘는 두 경우는 되감는다**(`editYear`를 넘길 때만):
 *   · 전해 12월 시작 → **1월 세션**. 1월 판의 앞칸은 전해 12월이고, 세션이 28~30일 단위로 흘러가
 *     1월 세션이 전해 말에 시작하는 건 정상이다(붙여넣기 파서도 "1월 12/28~1/24"를 그렇게 읽는다).
 *     이걸 안 되감으면 1월을 칠하려던 드래그가 **12월 세션을 덮어쓴다**.
 *   · 다음 해 1월 시작 → **12월 세션**. 12월 판의 뒷칸에서 시작한 경우.
 * 규칙 자체는 parse.ts의 wrap 추론과 같다 — 두 입력 경로(드래그·붙여넣기)가 같은 값을 만들어야 한다.
 */
export function labelMonthOf(start: string, editYear?: number): number {
  const month = Number(start.slice(5, 7));
  if (editYear === undefined) return month;
  const year = Number(start.slice(0, 4));
  if (year === editYear - 1 && month === 12) return 1;
  if (year === editYear + 1 && month === 1) return 12;
  return month;
}

/** 새 구간이 **다른 달** 세션과 겹치는지 — 겹치면 그 라벨월들(저장 전 경고용). */
export function overlappingMonths(
  candidate: { labelMonth: number; start: string; end: string },
  ranges: readonly PaintedRange[],
): number[] {
  const hit = new Set<number>();
  for (const r of ranges) {
    if (r.labelMonth === candidate.labelMonth || !r.start || !r.end) continue;
    if (candidate.start <= r.end && r.start <= candidate.end) hit.add(r.labelMonth);
  }
  return [...hit].sort((a, b) => a - b);
}
