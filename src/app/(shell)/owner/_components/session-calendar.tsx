"use client";

import { useCallback, useMemo, useState } from "react";
import { monthGrid, dragRange as toRange, type GridCell } from "@/features/periods/calendar-grid";

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 월별 세션 색 — 구 출석부(D:\attendance SessionSettingsModal)와 **같은 팔레트**.
 * 원장이 연간계획표를 그 색으로 읽어 왔으므로 바꾸지 않는다(수학 연간계획표의 월별 색 구분과 동일).
 */
const MONTH_BG: Record<number, string> = {
  1: "bg-rose-500",
  2: "bg-orange-500",
  3: "bg-amber-500",
  4: "bg-lime-500",
  5: "bg-emerald-500",
  6: "bg-teal-500",
  7: "bg-cyan-500",
  8: "bg-sky-500",
  9: "bg-blue-500",
  10: "bg-indigo-500",
  11: "bg-violet-500",
  12: "bg-fuchsia-500",
};

export type PaintedMonth = { labelMonth: number; start: string; end: string };

function MiniCalendar({
  year,
  month,
  painted,
  drag,
  holidays,
  onDown,
  onEnter,
  onClear,
}: {
  year: number;
  month: number;
  painted: readonly PaintedMonth[];
  drag: { start: string; end: string; labelMonth: number } | null;
  holidays: ReadonlySet<string>;
  onDown: (iso: string) => void;
  onEnter: (iso: string) => void;
  onClear: (month: number) => void;
}) {
  const cells = useMemo(() => monthGrid(year, month), [year, month]);
  const mine = painted.find((p) => p.labelMonth === month);

  /**
   * 이 날짜가 **어느 달 세션**에 속하는지 — 자기 달만 보지 않는다.
   * 🔴 구 출석부는 자기 달 구간만 칠해서, 2월 세션이 3/5까지 가도 3월 달력엔 안 보였다.
   *    그래서 3월 달력에서 3/1부터 다시 칠하게 되고 곧장 겹침이 됐다. 여기선 남의 달 세션도
   *    그 달 색으로 보여 준다(읽기 전용 고스트가 아니라 사실 그대로).
   */
  const ownerOf = useCallback(
    (iso: string): number | null => {
      for (const p of painted) if (p.start && p.end && iso >= p.start && iso <= p.end) return p.labelMonth;
      return null;
    },
    [painted],
  );

  const inDrag = useCallback(
    (iso: string) => !!drag && iso >= drag.start && iso <= drag.end,
    [drag],
  );

  const cell = (c: GridCell) => {
    const owner = ownerOf(c.iso);
    const dragging = inDrag(c.iso);
    const isHoliday = holidays.has(c.iso);
    const base = "h-5 rounded-sm text-[10px] font-medium transition-colors";

    let tone: string;
    if (dragging) tone = "bg-primary/30 text-foreground";
    else if (owner !== null) tone = `${MONTH_BG[owner]} text-white`;
    else if (c.inMonth) tone = "text-text-dim hover:bg-bg-soft";
    else tone = "text-text-faint hover:bg-bg-soft/60";

    return (
      <button
        key={c.iso}
        type="button"
        onMouseDown={(e) => {
          e.preventDefault();
          onDown(c.iso);
        }}
        onMouseEnter={() => onEnter(c.iso)}
        className={`${base} ${tone} ${isHoliday && owner === null && !dragging ? "line-through opacity-60" : ""}`}
        title={isHoliday ? `${c.iso} · 휴원일(수업 횟수에서 빠집니다)` : c.iso}
      >
        {c.day}
      </button>
    );
  };

  return (
    <div className="border-line bg-card rounded-lg border p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold text-white ${MONTH_BG[month]}`}>
          {month}월
        </span>
        {mine ? (
          <button
            type="button"
            onClick={() => onClear(month)}
            className="text-text-faint hover:text-danger text-[11px] leading-none"
            aria-label={`${month}월 세션 지우기`}
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="mb-0.5 grid grid-cols-7 gap-px">
        {DAY_NAMES.map((d, i) => (
          <div
            key={d}
            className={`text-center text-[10px] font-medium ${i === 0 ? "text-danger" : i === 6 ? "text-blue-500" : "text-text-faint"}`}
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px">{cells.map(cell)}</div>
    </div>
  );
}

/**
 * 12개월 달력 편집기 — 원장이 올린 연간계획표와 같은 모양(4열 × 3행, 42칸 고정, 월별 색).
 * 드래그로 구간을 칠하면 **시작일이 속한 달**의 세션이 된다(2월 세션이 3/5에 끝나도 라벨은 2월).
 */
export function SessionCalendar({
  year,
  painted,
  holidays,
  onPaint,
  onClear,
}: {
  year: number;
  painted: PaintedMonth[];
  holidays: string[];
  onPaint: (labelMonth: number, start: string, end: string) => void;
  onClear: (labelMonth: number) => void;
}) {
  const [anchor, setAnchor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const holidaySet = useMemo(() => new Set(holidays), [holidays]);

  const drag = useMemo(() => {
    if (!anchor || !cursor) return null;
    const { start, end } = toRange(anchor, cursor);
    // 라벨월 = **시작일의 달**. 구 출석부는 '드래그를 시작한 달력'에 귀속시켜, 3월 달력의 후행 4월 칸에서
    // 끌면 4월을 칠했다고 믿는데 3월에 저장됐다.
    return { start, end, labelMonth: Number(start.slice(5, 7)) };
  }, [anchor, cursor]);

  const finish = () => {
    if (drag) onPaint(drag.labelMonth, drag.start, drag.end);
    setAnchor(null);
    setCursor(null);
  };

  return (
    <div
      className="select-none space-y-2"
      onMouseUp={finish}
      onMouseLeave={() => {
        setAnchor(null);
        setCursor(null);
      }}
    >
      <p className="text-text-dim text-[12px]">
        달력에서 <b>드래그</b>해 세션 기간을 칠하세요. 칠한 구간은 <b>시작일이 속한 달</b>의 세션이 됩니다 —
        2월 세션이 3월 초까지 이어져도 그대로 두시면 됩니다.
        {drag ? (
          <span className="text-primary ml-2 font-bold">
            {drag.labelMonth}월 세션: {drag.start.slice(5).replace("-", "/")} ~ {drag.end.slice(5).replace("-", "/")}
          </span>
        ) : null}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {MONTHS.map((m) => (
          <MiniCalendar
            key={m}
            year={year}
            month={m}
            painted={painted}
            drag={drag}
            holidays={holidaySet}
            onDown={(iso) => {
              setAnchor(iso);
              setCursor(iso);
            }}
            onEnter={(iso) => {
              if (anchor) setCursor(iso);
            }}
            onClear={onClear}
          />
        ))}
      </div>
    </div>
  );
}
