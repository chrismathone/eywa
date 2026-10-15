"use client";

import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";

import { TONE_TEXT } from "@/lib/design/semantic-color";
import type { DirMark, MonthDay } from "@/features/shuttle/parent-month";
import { MonthDayDetail, type CellClass } from "./month-day-detail";
import { CELL_TEXT, MARK, MAX_PICK_DATES, pickedLabel } from "./month-marks";

/** 두 번 누르기로 치는 간격(ms). */
const DOUBLE_TAP_MS = 350;

/**
 * 월별 달력 격자 — 날짜를 **고른 뒤 [수정하기]를 눌러야** 그날 상세가 열린다(사용자 2026-10-01 *"드래그로 여러 날짜를
 * 동시에 셀렉 … 날짜를 셀렉하고 수정하기를 눌러야 표를 뜨게"*). 그전엔 칸을 누르면 바로 열렸다.
 *
 * 🔑 누르기 = 그 날짜 넣기/빼기 · 끌기 = 시작 칸부터 손가락이 있는 칸까지(달력 순서로 이어진 날) 한꺼번에.
 * 🔑 **두 번 누르면** 그날 상세(수업 · 셔틀)가 창으로 뜬다(사용자 2026-10-02) — 두 번의 누르기가 고르기를 켰다 끄므로
 *    선택 상태는 그대로다. 보기 전용 창이고, 고치려면 그 안의 버튼이나 [수정하기]로 간다.
 * 🔑 여러 날은 **고칠 수 있는 날**(오늘~62일 뒤 · 쉬는 날 아님)만 담는다 — 지난 날·쉬는 날은 하나만 골라 보기만 한다.
 * 🔴 여기는 고르기만 한다 — 저장은 상세의 같은 서버 액션이 날짜마다 다시 확인한다([[#77]]).
 * ⚠️ 격자 위에서는 끌기가 고르기라 화면이 밀리지 않는다(`touch-none`) — 스크롤은 격자 밖에서.
 */
export function MonthGrid({
  weeks,
  today,
  editableTo,
  baseHref,
  opened,
  classByDate,
}: {
  weeks: MonthDay[][];
  today: string;
  /** 미리 바꿀 수 있는 마지막 날(오늘 + 62일). */
  editableTo: string;
  /** 상세 주소의 앞부분 — 뒤에 `&dates=a,b`를 붙인다. */
  baseHref: string;
  /** 지금 상세가 열려 있는 날짜들(처음 선택 상태). */
  opened: string[];
  /** 수업 있는 날(= 등원하는 날) — 칸을 옅은 초록으로 칠하고 그날 수업(과목 · 시각)을 적는다(사용자 2026-10-02). */
  classByDate: Record<string, CellClass[]>;
}) {
  const days = useMemo(() => weeks.flat(), [weeks]);
  const order = useMemo(() => days.filter((d) => d.inMonth).map((d) => d.date), [days]);
  const editableSet = useMemo(
    () => new Set(days.filter((d) => d.inMonth && !d.holiday && d.date >= today && d.date <= editableTo).map((d) => d.date)),
    [days, today, editableTo],
  );
  const [picked, setPicked] = useState<string[]>(opened);
  const drag = useRef<{ anchor: string; moved: boolean } | null>(null);
  const lastTap = useRef<{ date: string; at: number } | null>(null);
  /** 두 번 눌러 연 날짜(상세 창). */
  const [detail, setDetail] = useState<string | null>(null);

  const dateAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest("[data-date]") as HTMLElement | null)?.dataset.date ?? null;

  function toggle(date: string) {
    setPicked((prev) => {
      // 지난 날·쉬는 날은 하나만(보기 전용) — 다시 누르면 푼다.
      if (!editableSet.has(date)) return prev.length === 1 && prev[0] === date ? [] : [date];
      const kept = prev.filter((d) => editableSet.has(d));
      if (kept.includes(date)) return kept.filter((d) => d !== date);
      return kept.length >= MAX_PICK_DATES ? kept : [...kept, date].sort();
    });
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    const date = dateAt(e.clientX, e.clientY);
    if (!date) return;
    drag.current = { anchor: date, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state) return;
    const date = dateAt(e.clientX, e.clientY);
    if (!date || (!state.moved && date === state.anchor)) return;
    state.moved = true;
    const a = order.indexOf(state.anchor);
    const b = order.indexOf(date);
    if (a < 0 || b < 0) return;
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1).filter((d) => editableSet.has(d));
    setPicked(range.slice(0, MAX_PICK_DATES));
  }
  function onPointerUp() {
    const state = drag.current;
    drag.current = null;
    if (!state || state.moved) return;
    toggle(state.anchor);
    // 같은 날짜를 잇달아 두 번 = 상세 창(둘째 누르기가 첫째의 고르기를 되돌린다).
    const now = Date.now();
    const prev = lastTap.current;
    if (prev && prev.date === state.anchor && now - prev.at <= DOUBLE_TAP_MS) {
      lastTap.current = null;
      setDetail(state.anchor);
    } else {
      lastTap.current = { date: state.anchor, at: now };
    }
  }
  const detailDay = detail ? days.find((d) => d.date === detail && d.inMonth) ?? null : null;

  const viewOnly = picked.length === 1 && !editableSet.has(picked[0]!);
  return (
    <>
      <div
        className="grid touch-none grid-cols-5 gap-1 select-none"
        // 🔑 달력을 화면 높이에 맞춰 최대한 키운다(사용자 2026-10-01) — 위·아래 고정 영역(약 23rem)을 뺀 높이를 주 수로 나눈다.
        style={{ "--cell-h": `max(3.5rem, calc((100dvh - 23rem) / ${weeks.length}))` } as CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
      >
        {days.map((d) => (
          <DayCell
            key={d.date}
            day={d}
            selected={picked.includes(d.date)}
            classes={classByDate[d.date] ?? NO_CLASSES}
            // 키보드(Enter·Space)로 누른 것만 여기서 — 포인터는 위 핸들러가 이미 처리했다(두 번 뒤집히지 않게).
            onKey={() => toggle(d.date)}
          />
        ))}
      </div>

      {picked.length === 0 ? (
        <p className="text-text-dim mt-2 text-center text-xs break-keep">
          날짜를 누르거나 끌어서 고른 뒤 [수정하기]를 눌러 주세요. 두 번 누르면 그날 내용을 자세히 볼 수 있어요.
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {picked.length > 1 ? (
            <p className="text-danger text-xs font-bold break-keep">
              여러 날을 함께 고치면 등원·하원·결석이 고른 날 모두 같은 내용으로 바뀌어요.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-bold">
              {picked.length}일 선택 · {pickedLabel(picked)}
            </span>
            <button
              type="button"
              onClick={() => setPicked([])}
              className="border-line flex h-9 shrink-0 items-center rounded-lg border px-3 text-sm font-bold"
            >
              선택 해제
            </button>
            <a
              href={`${baseHref}&dates=${picked.join(",")}`}
              className="bg-primary text-primary-foreground flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-bold"
            >
              {viewOnly ? "자세히 보기" : "수정하기"}
            </a>
          </div>
        </div>
      )}

      {detailDay ? (
        <MonthDayDetail
          day={detailDay}
          classes={classByDate[detailDay.date] ?? NO_CLASSES}
          past={detailDay.date < today}
          sheetHref={`${baseHref}&dates=${detailDay.date}`}
          editable={editableSet.has(detailDay.date)}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </>
  );
}

const NO_CLASSES: CellClass[] = [];
/** 아이들도 보는 화면이라 12시간제 — "16:20" → "4:20"(수업 시간표 탭과 같은 표기). */
const clock12 = (hm: string) => `${Number(hm.slice(0, 2)) % 12 === 0 ? 12 : Number(hm.slice(0, 2)) % 12}:${hm.slice(3, 5)}`;

/** 달력 한 칸 — 날짜 + 등원 줄 + 하원 줄(결석·쉬는 날은 한 줄). 이번 달 평일만 고를 수 있다. */
function DayCell({
  day,
  selected,
  classes,
  onKey,
}: {
  day: MonthDay;
  selected: boolean;
  classes: CellClass[];
  onKey: () => void;
}) {
  const hasClass = classes.length > 0;
  // 결석한 날은 쉬는 날과 같은 모양 — 회색 칸 · 빨간 날짜 · 빨간 "결석", 수업은 안 적는다(사용자 2026-10-02).
  const off = !!day.holiday || day.absent;
  if (!day.inMonth) return <span aria-hidden className="min-h-(--cell-h)" />;
  // 🔑 내용은 날짜와 **같은 첫 줄**에 선다(사용자 2026-10-01 — 아래로 밀려 내려가지 않게). 안 들어가면 다음 줄로 접힌다.
  const box = `flex min-h-(--cell-h) flex-wrap content-start items-baseline gap-x-1 rounded-lg border px-1.5 py-1 text-left ${
    selected
      ? "bg-primary/25 border-primary"
      : off
        ? "bg-att-weekend border-line"
        : hasClass
          ? "bg-green-soft border-line"
          : "bg-card border-line"
  } ${day.isToday ? "ring-primary ring-2" : ""}`;
  return (
    <button
      type="button"
      data-date={day.date}
      aria-pressed={selected}
      aria-label={`${day.day}일${day.holiday ? ` ${day.holiday}` : day.absent ? " 결석" : hasClass ? " 수업 있는 날" : ""}`}
      className={box}
      onClick={(e) => {
        if (e.detail === 0) onKey();
      }}
    >
      <span className={`num text-xs font-bold ${off ? "text-danger" : ""}`}>{day.day}</span>

      {day.holiday ? (
        <span style={CELL_TEXT} className="text-danger font-bold break-keep">{day.holiday}</span>
      ) : day.absent ? (
        <span style={CELL_TEXT} className={`font-bold ${TONE_TEXT.critical}`}>결석</span>
      ) : (
        <span style={CELL_TEXT} className="flex flex-wrap gap-x-1">
          <Line label="등" mark={day.in} />
          <Line label="하" mark={day.out} />
        </span>
      )}
      {/* 그날 수업 — 과목 한 줄 + 시각 한 줄(칸이 좁아 둘로 나눈다). 쉬는 날엔 안 적는다. */}
      {hasClass && !off ? (
        <span style={CELL_TEXT} className="mt-0.5 flex w-full flex-col gap-0.5">
          {classes.map((c) => (
            <span key={`${c.label}|${c.start}`} className="flex flex-col">
              <b className="text-green truncate">{c.label}</b>
              <span className="num whitespace-nowrap">
                {clock12(c.start)}~{clock12(c.end)}
              </span>
            </span>
          ))}
        </span>
      ) : null}
    </button>
  );
}

function Line({ label, mark }: { label: string; mark: DirMark }) {
  if (!mark) return null;
  const m = MARK[mark];
  return (
    <span className="whitespace-nowrap">
      <span className="text-text-dim">{label}</span> <b className={m.tone}>{m.glyph}</b>
    </span>
  );
}
