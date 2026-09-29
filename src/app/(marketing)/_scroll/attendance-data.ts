/**
 * 랜딩 출석부 장면의 예시 표(2026년 9월 · 월·수·금 반). 이름·숫자는 전부 예시다.
 * 서버가 표를 그대로 그리고(`attendance-table`), 스크롤 애니메이션은 칸의 `data-o` 순서대로 켠다.
 */
export type AttTone = "g" | "a" | "r" | "p";
export type AttCell =
  | { kind: "hol" }
  | { kind: "out" }
  | { kind: "off" }
  | { kind: "later" }
  | { kind: "mark"; tone: AttTone; label: string; memo: string; order: number };
export type AttRow = { name: string; note: string; cells: AttCell[]; sum: number };
export type AttDay = { day: number; label: string; holiday: boolean };

const STUDENTS: [string, string][] = [
  ["김하늘", ""], ["이준서", ""], ["박서윤", ""], ["최도윤", ""], ["정하린", ""], ["한지안", "9/7 입학"],
];
const CLASS_DOWS = [1, 3, 5];
const HOLIDAYS = new Set([24, 25, 26]);
const TODAY = 22;
const LAST_DAY = 26;
const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];
/** 2026-09-01은 화요일 — Date를 안 써서 서버 시간대와 무관하게 같은 표가 나온다. */
const dowOf = (day: number) => (day + 1) % 7;
const MARKS: Record<string, [AttTone, string, string]> = {
  "이준서|9": ["r", "결", "9/16 보강 예정"],
  "이준서|16": ["p", "보", "9/9 결석분"],
  "최도윤|14": ["a", "지", ""],
  "정하린|4": ["r", "결", "사전 통보 · 병원"],
  "김하늘|21": ["g", "0.5", ""],
};

/** 칸 글자 → 시수(결석 0 · 보강·지각 1 · 숫자는 그대로). 애니메이션이 합계를 다시 셀 때도 같은 규칙이다. */
export function unitsOf(label: string): number {
  if (label === "결") return 0;
  if (label === "보" || label === "지") return 1;
  return parseFloat(label);
}

export function buildAttendance(): { days: AttDay[]; rows: AttRow[] } {
  const days: AttDay[] = [];
  for (let d = 1; d <= LAST_DAY; d++) {
    if (dowOf(d) === 0) continue;
    days.push({ day: d, label: HOLIDAYS.has(d) ? "추석" : DOW_KO[dowOf(d)], holiday: HOLIDAYS.has(d) });
  }
  const rows = STUDENTS.map(([name, note], si): AttRow => {
    let sum = 0;
    const cells = days.map(({ day }): AttCell => {
      if (HOLIDAYS.has(day)) return { kind: "hol" };
      if (si === 5 && day < 7) return { kind: "out" };
      if (!CLASS_DOWS.includes(dowOf(day))) return { kind: "off" };
      if (day > TODAY) return { kind: "later" };
      const [tone, label, memo] = MARKS[`${name}|${day}`] ?? ["g", "1", ""];
      sum += unitsOf(label);
      return { kind: "mark", tone, label, memo, order: day * 10 + si };
    });
    return { name, note, cells, sum };
  });
  return { days, rows };
}
