"use client";

import { useEffect, useRef, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { CONTROL_H, CONTROL_LABEL, CONTROL_SQUARE } from "@/components/ui/control-scale";
import { shortDateLabel } from "../dates";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 수업일 고르기 — 달력(원장 2026-10-28 *"수업일이 저렇게 쌓이면 … 깨질 확률 높음 캘린더로 변경"*).
 * 옛 칩 줄은 달마다 수업일 수만큼 늘어 툴바가 넘쳤다. 이제 ‹ 날짜 › 한 덩어리 + 눌러서 여는 달력 한 장이다.
 * 달력은 이 반의 수업일만 누를 수 있고(나머지 날은 흐리게), 화살표는 앞뒤 수업일로 옮긴다.
 * 달 이동도 이 달력 하나가 맡는다(원장 2026-10-28 *"위에 달력과 수업일 달력이 따로임 — 수업일 달력 하나만"*):
 * 달력 머리의 ‹ › 가 앞뒤 달, 바깥 화살표는 그 달 첫·마지막 수업일에서 앞뒤 달의 마지막·첫 수업일로 넘어간다.
 */
export function DateCalendar({
  month, dates, offDays = {}, value, today, onChange, onGo, pending = false,
}: {
  month: string;
  dates: string[];
  /** 쉰 휴일 — 고를 수는 있고(그날 수업했다면 체크) 빨간 글자로 구분한다. */
  offDays?: Record<string, string>;
  value: string | null;
  today: string;
  onChange: (date: string) => void;
  /** 다른 달로 — `pick`은 그 달에서 고를 날(`first`·`last`·날짜, 없으면 기본 날). */
  onGo: (month: string, pick?: string) => void;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const at = value ? dates.indexOf(value) : -1;
  const prev = at > 0 ? dates[at - 1] : null;
  const next = at >= 0 && at < dates.length - 1 ? dates[at + 1] : null;
  const [y, m] = month.split("-").map(Number);
  const monthOf = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const thisMonth = today.slice(0, 7);
  const goPrev = () => (prev ? onChange(prev) : onGo(monthOf(-1), "last"));
  const goNext = () => (next ? onChange(next) : onGo(monthOf(1), "first"));
  const go = (target: string, pick?: string) => { setOpen(false); onGo(target, pick); };
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  const arrow = `${CONTROL_SQUARE} border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center justify-center rounded-lg border disabled:opacity-40`;

  return (
    <div ref={box} className={`relative flex items-center gap-1 ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
      <span className="micro shrink-0">수업일</span>
      <button type="button" className={arrow} disabled={pending} onClick={goPrev} aria-label="이전 수업일">
        <EyIcon name="chevronLeft" size={14} />
      </button>
      <button
        type="button"
        className={`${CONTROL_H} ${CONTROL_LABEL} border-line hover:bg-bg-soft inline-flex min-w-36 items-center justify-center gap-1.5 rounded-lg border px-2 font-bold whitespace-nowrap`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="달력에서 수업일 고르기"
      >
        <EyIcon name="calendar" size={14} />
        {value ? shortDateLabel(value) : `${m}월 수업일 없음`}
      </button>
      <button type="button" className={arrow} disabled={pending} onClick={goNext} aria-label="다음 수업일">
        <EyIcon name="chevronRight" size={14} />
      </button>
      {open ? (
        <div className="bg-card shadow-card border-line absolute top-full left-0 z-30 mt-1 w-72 rounded-xl border p-3">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className={arrow} onClick={() => go(monthOf(-1))} aria-label="이전 달">
              <EyIcon name="chevronLeft" size={14} />
            </button>
            <p className="text-sm font-bold">{y}년 {m}월</p>
            <button type="button" className={arrow} onClick={() => go(monthOf(1))} aria-label="다음 달">
              <EyIcon name="chevronRight" size={14} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {WEEK.map((w) => <span key={w} className="text-text-dim py-1 font-semibold">{w}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={`b${i}`} />;
              const day = Number(d.slice(8));
              const isClass = dates.includes(d);
              const selected = d === value;
              const off = offDays[d];
              if (!isClass) return <span key={d} className="text-text-placeholder py-1.5">{day}</span>;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => { onChange(d); setOpen(false); }}
                  className={`rounded-lg py-1.5 font-bold ${selected ? "bg-primary text-primary-foreground" : off ? "bg-bg-soft text-danger hover:bg-bg-soft/70" : "bg-primary-soft text-primary hover:bg-primary/20"} ${d === today && !selected ? "ring-primary ring-1" : ""}`}
                  aria-pressed={selected}
                  aria-label={off ? `${day}일 휴일(${off})` : undefined}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-text-dim text-xs">색 칸 = 이 반 수업일 · 빨간 글자 = 휴일 · 테두리 = 오늘</p>
            {month !== thisMonth || (dates.includes(today) && value !== today) ? (
              <button
                type="button"
                className="text-primary shrink-0 text-xs font-bold hover:underline"
                onClick={() => (month === thisMonth ? (onChange(today), setOpen(false)) : go(thisMonth, today))}
              >
                오늘로
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
