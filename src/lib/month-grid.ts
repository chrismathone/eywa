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

// === 기간 막대(Notion식 스팬 바) 배치 — 시작일~마감일이 여러 날에 걸치면 한 주 안에서 막대로 표시 ===
export type TaskSpan = { id: string; start: string; end: string }; // YYYY-MM-DD, start<=end 보장
export type SpanBar = {
  id: string;
  colStart: number; // 1..7 (그 주 안 시작 열)
  colSpan: number; // 몇 칸 차지
  lane: number; // 세로 레인(겹치지 않게 쌓는 줄, 0부터)
  continuesLeft: boolean; // 이 주 이전(왼쪽)에서 이어짐
  continuesRight: boolean; // 이 주 이후(오른쪽)로 이어짐
};

/**
 * 한 주(날짜 7개)에 걸치는 업무 스팬들을 겹치지 않게 레인 배치. 그리디 구간 스케줄링(colStart 오름차순,
 * 같은 시작이면 긴 것 먼저) — 각 레인은 마지막 점유 열을 넘는 스팬만 새로 얹는다. 주 경계로 잘린 스팬은
 * continuesLeft/Right로 표시(막대 끝을 각져 보이게).
 */
export function buildWeekBars(weekDays: string[], spans: TaskSpan[]): { bars: SpanBar[]; lanes: number } {
  const w0 = weekDays[0]!;
  const w6 = weekDays[6]!;
  const clipped = spans
    .map((s) => {
      const from = s.start > w0 ? s.start : w0;
      const to = s.end < w6 ? s.end : w6;
      if (from > w6 || to < w0 || from > to) return null;
      const colStart = weekDays.indexOf(from) + 1;
      const colEnd = weekDays.indexOf(to) + 1;
      return {
        id: s.id,
        colStart,
        colSpan: colEnd - colStart + 1,
        continuesLeft: s.start < w0,
        continuesRight: s.end > w6,
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .sort((a, b) => a.colStart - b.colStart || b.colSpan - a.colSpan);

  const laneEnd: number[] = []; // laneEnd[lane] = 그 레인의 마지막 점유 열
  const bars: SpanBar[] = [];
  for (const c of clipped) {
    let lane = 0;
    while (lane < laneEnd.length && laneEnd[lane]! >= c.colStart) lane++;
    laneEnd[lane] = c.colStart + c.colSpan - 1;
    bars.push({ ...c, lane });
  }
  return { bars, lanes: laneEnd.length };
}

/** 각 날짜별로 그날에 걸치는 스팬 개수 — 셀 "+N건 더" 계산용. */
export function countSpansPerDay(weekDays: string[], spans: TaskSpan[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of weekDays) out[d] = 0;
  for (const s of spans) {
    for (const d of weekDays) {
      if (s.start <= d && d <= s.end) out[d] = (out[d] ?? 0) + 1;
    }
  }
  return out;
}
