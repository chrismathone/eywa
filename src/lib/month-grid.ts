// 월간 달력 그리드 순수 유틸 — 직원 상세 '월간일정' 탭(Notion 업무)용. 라이브러리 0(week.ts·report-trend 에토스).
// 입출력은 "YYYY-MM"(월) / "YYYY-MM-DD"(날짜) 문자열. UTC 기준 파싱으로 서버 타임존 무관(결정적).
// ⚠️ server-only 금지 — 클라 월간뷰가 import [[#61]]. KST 시드(kstMonth/kstToday)는 호출부에서만 [[date-kst]].
// 주 시작 = 일요일(Notion 원본 달력과 동일: 일 월 화 수 목 금 토). weekStartsOn=1로 월요일 시작도 가능.

export type MonthCell = {
  date: string; // YYYY-MM-DD
  day: number; // 1..31
  inMonth: boolean; // 이번 달인지(다른 달은 흐리게)
  dow: number; // 0=일 .. 6=토
};

function parseMonth(month: string): { year: number; monthIdx: number } {
  const [y, m] = month.split("-").map(Number);
  return { year: y ?? 1970, monthIdx: (m ?? 1) - 1 };
}
function fmt(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

/** 월(YYYY-MM)의 1일이 속한 주부터 말일이 속한 주까지, 7일씩 묶은 주 배열. */
export function buildMonthGrid(month: string, opts: { weekStartsOn?: 0 | 1 } = {}): MonthCell[][] {
  const weekStartsOn = opts.weekStartsOn ?? 0;
  const { year, monthIdx } = parseMonth(month);
  const firstDow = new Date(Date.UTC(year, monthIdx, 1)).getUTCDay(); // 0=일
  const lead = (firstDow - weekStartsOn + 7) % 7; // 1일 앞 빈 칸 수
  const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const totalCells = Math.ceil((lead + daysInMonth) / 7) * 7;

  const start = new Date(Date.UTC(year, monthIdx, 1 - lead));
  const cells: MonthCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const dt = new Date(start);
    dt.setUTCDate(start.getUTCDate() + i);
    cells.push({
      date: fmt(dt),
      day: dt.getUTCDate(),
      inMonth: dt.getUTCMonth() === monthIdx && dt.getUTCFullYear() === year,
      dow: dt.getUTCDay(),
    });
  }
  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "2026-07" → "2026년 7월". */
export function monthLabel(month: string): string {
  const { year, monthIdx } = parseMonth(month);
  return `${year}년 ${monthIdx + 1}월`;
}

/** 월 이동: "2026-07" +1 → "2026-08", "2026-01" -1 → "2025-12". */
export function shiftMonth(month: string, delta: number): string {
  const { year, monthIdx } = parseMonth(month);
  const dt = new Date(Date.UTC(year, monthIdx + delta, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** 월 범위 [1일, 다음달 1일) — Notion date 필터(on_or_after/before)용. */
export function monthRange(month: string): { start: string; endExclusive: string } {
  return { start: `${month}-01`, endExclusive: `${shiftMonth(month, 1)}-01` };
}

/** 요일 헤더 라벨(주 시작 기준 회전). weekStartsOn=0 → [일..토]. */
export function weekdayHeaders(weekStartsOn: 0 | 1 = 0): string[] {
  const base = ["일", "월", "화", "수", "목", "금", "토"];
  return [...base.slice(weekStartsOn), ...base.slice(0, weekStartsOn)];
}
