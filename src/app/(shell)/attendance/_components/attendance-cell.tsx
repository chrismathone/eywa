"use client";

import { useEffect, useRef, useState } from "react";
import type { AttendanceStatus } from "@/features/attendance/server/queries";
import {
  CELL_SCROLL_MARGIN,
  STATUS_TEXT,
  cellDisplay,
  ghostBreakdown,
  rollupDay,
  slotBreakdown,
  type SlotMark,
} from "@/features/attendance/cell-display";
import { cellKey, rowKey } from "@/features/attendance/grid/model";
import { useCellState } from "./grid-context";
import { CellPopover, type PopoverAnchor } from "./cell-popover";

/**
 * 출석부 시트의 한 칸.
 *
 * 조작은 시트와 같다: 클릭=선택 · 숫자 타이핑=입력(0 결석 / 1·1.5·2 출석+시수) · 방향키·Tab·Enter 이동 ·
 * Shift로 범위 · Ctrl+C/V · Ctrl+Z · 우하단 손잡이 드래그=채우기 · Delete=지우기.
 * 숫자로 표현할 수 없는 것(지각·조퇴·보강·메모)만 **우클릭(=더블클릭) 팝오버**가 맡는다.
 * 7일이 지나 잠긴 칸에서도 팝오버는 열린다 — 상태·시수는 잠기고 **메모만** 고칠 수 있다.
 *
 * ⚠️ 표기(숫자·배경색)는 `cell-display.ts` 단일 소스를 그대로 쓴다 — 격자에서 다시 그리지 않는다.
 * ⚠️ 이 칸은 **자기 상태만 구독**한다(`useCellState`). 옆 칸이 바뀌어도 다시 그리지 않는다 — 표가
 *    수천 칸이라 전역 구독으로 만들면 방향키가 밀린다.
 */
export function AttendanceCell({
  studentId,
  classId,
  sessionDate,
  initialStatus,
  note,
  initialUnits,
  attendDay,
  muted,
  outside,
  derived,
  locked,
  daySlots,
  otherSlots,
  sharedDay,
}: {
  studentId: string;
  classId: string;
  sessionDate: string;
  initialStatus: AttendanceStatus | null;
  note?: string | null;
  initialUnits?: number | null;
  /** 그 학생이 그 요일에 등원하는지 — 기록 없는 칸의 하이라이트. */
  attendDay?: boolean;
  /** 주말·공휴일 등 수업이 없는 날(회색). */
  muted?: boolean;
  /**
   * 그 날 이 반 소속이 아니었다(입원 전·퇴원 후) — 진한 회색.
   * ⚠️ **입력을 막지 않는다** — 퇴원 뒤 보강 출석이 실제로 있고, 막으면 이미 들어온 기록을 고칠 길이 사라진다.
   */
  outside?: boolean;
  /** 수기 기록이 아니라 수업보고서에서 파생한 값 — 툴팁에 출처 표시. */
  derived?: boolean;
  /** 수정 기간(7일)이 지나 강사가 못 고치는 칸 — 이유를 담은 문장. */
  locked?: string | null;
  /**
   * 그날 교시가 **둘 이상**일 때만 오는 교시별 기록(0196a) — 숫자(합)·줄무늬·툴팁의 근거.
   * 대부분의 칸은 undefined라 종전과 완전히 같이 그려진다.
   */
  daySlots?: SlotMark[];
  /**
   * **이 표가 세지 않는 교시**(강사 전체 보기의 남의 교시·자리 JJ·LAB) — 값이 아니라 표시 근거다.
   * 값이 비어 있을 때만 빗금으로 드러난다: 빈칸으로 두면 사람이 그 위에 다시 찍어 남의 기록을
   * 덮는다(#103). 반별 보기에선 항상 undefined라 종전과 완전히 같이 그려진다.
   *
   * 🔴 **값이 하나도 없는 칸(빗금)은 이 화면에서 입력을 안 받는다**(`locked`로 사유를 알린다).
   *    권한이 아니라 **안전장치**다: 월간 격자의 저장은 교시를 모른 채 그날 **모든 교시**에 가므로
   *    (save-targets ①) 여기서 받으면 남의 기록·자리(JJ)를 화면에 흔적도 없이 덮거나 지운다. 게다가
   *    낙관값은 서버 값과 같아질 때만 벗겨지는데 서버는 이 칸을 영원히 비워 두므로 친 숫자가
   *    새로고침 전까지 시수·출석률에 남는다. 고칠 길은 막지 않는다 — **반별 보기에선 그대로 열려 있다**.
   * ⚠️ 값이 **있는** 칸(내 교시 + 남의 교시)은 잠그지 않는다. 대신 툴팁이 "함께 바뀐다"를 말한다.
   */
  otherSlots?: SlotMark[];
  /**
   * 이 칸의 값에 **교시를 안 남긴 기록**이 섞였다(강사 전체 보기 전용, queries `dayAxis`).
   * 그런 기록은 담당을 가릴 수 없어 좁히지 않으므로 **그 반 담당 전원 화면에 같은 값**으로 잡힌다 —
   * 툴바 칩("칸 = 이 선생님 교시")의 유일한 예외라, 그 사실을 이 칸이 직접 말한다.
   */
  sharedDay?: boolean;
}) {
  const row = rowKey(classId, studentId);
  const key = cellKey(row, sessionDate);
  const { state, ctx } = useCellState(key);
  // 팝오버가 고친 메모(null = 아직 안 고침 → 서버 값 사용). effect로 state를 되쓰지 않는다(#25).
  const [noteEdit, setNoteEdit] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverAnchor | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // 격자에 키보드로 들어올 수 있는 **단 하나의 탭 정거장**(첫 칸). 그 뒤로는 방향키가 받는다 —
  // 칸마다 탭 정거장을 두면 31×N번을 눌러야 표를 지나칠 수 있다.
  const isFirst = ctx?.store.rows[0] === row && ctx?.store.cols[0] === sessionDate;

  // 값은 격자(낙관적 반영)가 진실 — 격자가 없으면 서버가 그린 초기값.
  const status = (ctx ? ((state.value?.s ?? null) as AttendanceStatus | null) : initialStatus) ?? null;
  const units = ctx ? state.value?.u ?? null : initialUnits ?? null;
  const editing = state.active && state.buffer !== null;

  // 활성 칸이 화면 밖이면 따라 스크롤(가로 31칸이라 방향키 이동에 필수) + 포커스도 함께 옮긴다
  // (키보드만 쓰는 사용자가 격자 안에서 길을 잃지 않게).
  useEffect(() => {
    if (!state.active) return;
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [state.active]);

  // 기록이 지워진 칸엔 메모도 없다(행 자체가 삭제된다) — 접힌 모서리가 남으면 화면이 거짓말을 한다.
  // 파생이라 effect가 필요 없다.
  const noteVal = ctx && state.value === null ? "" : noteEdit ?? note ?? "";

  // 하루에 교시가 둘 이상인 칸 — 합계·줄무늬는 **서버가 준 값 그대로일 때만** 사실이다.
  // 값을 고치는 순간(status·시수가 초기값과 달라짐) 접었던 근거가 무너지므로 평범한 한 칸으로 돌아간다.
  // ⚠️ 파생 뱃지(fromReport)가 쓰는 것과 같은 관용구다 — 서버 값과 같을 때만 출처를 말한다.
  const dayRollup = daySlots && daySlots.length > 1 ? rollupDay(daySlots) : null;
  const pristine = status === initialStatus && (units ?? null) === (initialUnits ?? null);
  const day = pristine ? dayRollup : null;
  // 세지 않는 교시는 **값이 비어 있을 때만** 빗금으로 드러낸다 — 값이 있으면 그 값이 칸의 주인이고,
  // 세지 않는 교시는 아래 툴팁에서 계속 밝힌다.
  const ghost = !status && !!otherSlots?.length;
  // 🔴 빗금 칸엔 값이 없어도 **메모는 있다** — 실측 78칸이 결석 사유였다("병결"·"가족여행").
  //    noteVal은 값이 없으면 비우는 규약(지워진 칸의 유령 메모 방지)이라, 이 칸만 따로 살린다.
  const ghostNote = ghost ? noteEdit ?? note ?? "" : "";
  const display = cellDisplay(status, units, { attendDay, muted, outside, day, ghost });
  const fromReport = derived && status === initialStatus;
  // 잠긴 칸이라도 **메모는 보여 준다** — 잠금 사유만 남기고 메모를 감추면 왜 잠겼는지만 알고 뭐라 적혔는지는 못 본다.
  const title = [
    locked || (status ? STATUS_TEXT[status] : null),
    // 교시가 여럿인 날 — 칸엔 합계 하나뿐이라, 무엇을 접었는지 여기서 펼쳐 준다.
    day ? `${day.count}교시 · ${slotBreakdown(day.slots)}` : null,
    // 이 표가 안 세는 교시(자리·남의 교시) — 숫자엔 없지만 기록은 있다는 사실을 여기서 밝힌다.
    // ⚠️ 값이 **있는** 칸(내 교시 + 남의 교시가 같은 날)은 고치면 남의 교시까지 함께 바뀐다
    //    (저장은 그날 모든 교시에 간다, save-targets ①). 숫자가 1이라 사정거리가 안 보이므로 여기서 말한다.
    otherSlots?.length
      ? `${ghostBreakdown(otherSlots)}${status ? " · 이 칸을 고치면 이 교시들도 함께 바뀝니다" : ""}`
      : null,
    // 회색 칸의 뜻을 말해 준다 — 색만 다르면 "왜 여기만 회색이지"로 끝난다.
    outside ? (status ? "재원 기간 밖 기록(보강 등)" : "이 반 재원 기간이 아닙니다") : null,
    // 칩의 예외 — 교시가 안 찍힌 기록이라 이 반 담당 전원에게 같은 값이 잡힌다(위 sharedDay 주석).
    sharedDay ? "교시가 안 찍힌 기록이라 이 반 전체 몫으로 셉니다(다른 선생님 화면에도 같은 값)" : null,
    fromReport ? "수업보고서 자동 판정" : null,
    noteVal || ghostNote || null,
  ]
    .filter(Boolean)
    .join(" · ");

  const openPopoverAt = (el: HTMLElement | null) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = typeof window !== "undefined" ? window.innerHeight : 9999;
    // 아래 공간이 팝오버 높이(~300px)보다 좁으면 위로 뒤집는다 — 마지막 행에서 저장 버튼이 화면 밖으로 안 나가게.
    const openUp = vh - r.bottom < 300 && r.top > vh - r.bottom;
    setPopover(openUp ? { x: r.left, bottom: vh - r.top + 4 } : { x: r.left, top: r.bottom + 4 });
  };
  // 🔴 **잠긴 칸도 연다** — 메모는 7일 창의 적용을 받지 않는다(원장 2026-08-06: "메모는 언제든 추가할 수 있어야").
  //    팝오버가 잠금 사유를 띄우고 메모만 열어 준다. 예전엔 아무 반응이 없어 "더블클릭이 안 된다"로 보였다.
  // ⚠️ 우클릭은 **항상** 기본 메뉴를 막는다 — 안 막으면 잠긴 칸에서 브라우저 메뉴가 튀어나온다.
  const openPopover = (e: React.MouseEvent) => {
    e.preventDefault();
    openPopoverAt(e.currentTarget as HTMLElement);
  };

  return (
    <>
      <div
        ref={ref}
        data-cell-key={key}
        role="gridcell"
        tabIndex={state.active || isFirst ? 0 : -1}
        aria-label={`${sessionDate} ${status ? STATUS_TEXT[status] : "미기록"}${day ? ` 외 ${day.count - 1}교시` : ""}${
          otherSlots?.length ? ` · 세지 않는 교시 ${otherSlots.length}건` : ""
        }`}
        title={title || undefined}
        // 색이 갈린 교시가 섞인 날만 — 인라인 배경이 클래스 배경을 이긴다(글자색은 클래스 그대로).
        style={display.style}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          ctx?.selectCell(row, sessionDate, e.shiftKey);
        }}
        // ⚠️ 이 칸 **안의 입력칸**이 포커스를 받아도 여기로 버블한다 — 이미 활성이면 손대지 않는다
        //    (안 그러면 타이핑을 시작하는 순간 버퍼가 확정돼 버린다).
        onFocus={() => {
          if (!state.active) ctx?.selectCell(row, sessionDate, false);
        }}
        onKeyDown={(e) => {
          if (e.key === " " && !editing) {
            e.preventDefault();
            openPopoverAt(ref.current);
          }
        }}
        onDoubleClick={openPopover}
        onContextMenu={openPopover}
        // `scroll-mt` — 방향키 이동 시 활성 칸이 고정 헤더 뒤로 숨지 않게(cell-display.ts 주석 참조).
        className={`absolute inset-0 flex items-center justify-center text-[11px] font-bold select-none ${CELL_SCROLL_MARGIN} ${display.className} ${
          locked ? "cursor-not-allowed" : "cursor-cell"
        }`}
      >
        {editing ? (
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            aria-label="시수 입력"
            value={state.buffer ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^[0-9]*[.,]?[0-9]*$/.test(v)) ctx?.store.setBuffer(v.replace(",", "."));
            }}
            onKeyDown={(e) => {
              // 인라인 input 안에서는 문서 리스너가 비켜 있으므로(입력칸 무시) 여기서 직접 처리한다.
              const moves: Record<string, [number, number]> = {
                Enter: [0, e.shiftKey ? -1 : 1],
                Tab: [e.shiftKey ? -1 : 1, 0],
                ArrowUp: [0, -1],
                ArrowDown: [0, 1],
              };
              const d = moves[e.key];
              if (d) {
                e.preventDefault();
                ctx?.commitAndMove(d[0], d[1]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                ctx?.store.setBuffer(null);
              }
            }}
            className="text-primary absolute inset-0 h-full w-full border-0 bg-white/90 p-0 text-center text-[12px] font-bold outline-none"
          />
        ) : (
          display.text
        )}

        {/* 범위 선택 — 반투명 파란 덮개(시트 selection). */}
        {state.selected && !state.active ? (
          <span
            aria-hidden
            className="ring-primary/40 pointer-events-none absolute inset-0 z-20 bg-blue-500/20 ring-1 ring-inset"
          />
        ) : null}
        {/* 활성 칸 테두리 */}
        {state.active && !editing ? (
          <span aria-hidden className="ring-primary pointer-events-none absolute inset-0 z-30 ring-2 ring-inset" />
        ) : null}
        {/* Ctrl+C 복사 표시 — 시트의 점선 */}
        {state.copied && !state.active ? (
          <span
            aria-hidden
            className="border-primary pointer-events-none absolute inset-0 z-30 border-2 border-dashed"
          />
        ) : null}
        {/* 드래그 채우기 손잡이 — 활성 칸 우하단 */}
        {state.active && !editing && !locked ? (
          <span
            role="button"
            aria-label="드래그하여 옆 칸에 같은 값 채우기"
            title="드래그하여 옆 칸에 같은 값 채우기"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              ctx?.startFill();
            }}
            className="bg-primary absolute right-[-2px] bottom-[-2px] z-40 size-1.5 cursor-crosshair ring-1 ring-white"
          />
        ) : null}
        {/* 메모 — 포스트잇 모서리 접힘(구 출석부 표기) */}
        {noteVal || ghostNote ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-0 right-0 size-2"
            style={{
              background: "linear-gradient(225deg,#fbbf24 0%,#f59e0b 48%,rgba(0,0,0,0.25) 50%,transparent 51%)",
            }}
          />
        ) : null}
      </div>

      {popover ? (
        <CellPopover
          studentId={studentId}
          classId={classId}
          sessionDate={sessionDate}
          status={status}
          units={units}
          note={noteVal || ghostNote}
          locked={locked ?? null}
          otherCount={otherSlots?.length ?? 0}
          anchor={popover}
          onClose={() => setPopover(null)}
          onSaved={(next) => {
            setNoteEdit(next.note);
            ctx?.setLocal(key, next.status ? { s: next.status, u: next.units } : null);
          }}
        />
      ) : null}
    </>
  );
}
