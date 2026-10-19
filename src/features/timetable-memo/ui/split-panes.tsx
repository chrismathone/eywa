"use client";

import type { ReactNode } from "react";

/**
 * 시간표 | 메모 시트 — 가로 스크롤 한 줄에 **두 판을 나란히**, 판마다 화면 폭 하나씩(원장 2026-10-19
 * *"오른쪽으로 스크롤 하면 … 보이도록"* + *"시간표 영역이랑 우측 엑셀 영역을 구분해서 침범하지 않게"*).
 * · 바깥 상자는 **가로로만** 넘긴다. 세로는 판마다 자기 스크롤 — 시간표 판은 시간표만, 시트 판은 엑셀 창.
 *   그래서 시트 쪽에서 행·열을 늘려도 시간표가 밀리지 않고, 시간표를 내려도 시트는 제자리다.
 * · 판 폭 = 바깥 상자 폭(CSS 격자 `auto-cols-[100%]`) — 자바스크립트로 재지 않아 첫 그림부터 제 크기다.
 * 🔴 바깥 상자는 명단 드래그(dnd-kit)의 **자동 스크롤 대상이 아니다**(`data-split-x` — roster-move.tsx `canScroll`).
 *    안 막으면 학생을 오른쪽 가장자리로 끌 때 화면이 시트 쪽으로 미끄러져 놓을 반이 사라진다.
 * ⚠️ 스냅(scroll-snap)을 걸지 말 것 — 조금만 넘겨 시트를 엿보면 시간표 쪽으로 도로 튕긴다(실측).
 * ⚠️ 이 상자에 `contain`·`container-type`을 주지 말 것 — 드래그 고스트(position:fixed)의 좌표계가 바뀐다([[#98]]).
 */
export const SPLIT_ID = "timetable-memo-split";
/** 바깥 가로 상자 표식 — 드래그 자동 스크롤이 이 상자는 굴리지 않는다. */
export const SPLIT_X_ATTR = "data-split-x";
const SHEET_PANE_ATTR = "data-memo-sheet-pane";

export function scrollSplitTo(which: "timetable" | "sheet") {
  const box = document.getElementById(SPLIT_ID);
  const pane = box?.querySelector<HTMLElement>(`[${SHEET_PANE_ATTR}]`);
  if (!box || !pane) return;
  box.scrollTo({ left: which === "sheet" ? pane.offsetLeft : 0, behavior: "smooth" });
}

/**
 * `top` = 시간표 툴바(주차·과목·필터) — 시간표 판 **안** 맨 위에 고정한다(원장 2026-10-19 *"메모시트 시간표 같은 위치로"*).
 * 툴바가 두 판 위에 걸쳐 있으면 시트로 넘어가도 시간표 필터가 남아 시트를 내리누른다. 판 안에 두면 오른쪽으로 넘길 때
 * 시간표와 함께 밀려나고, 시트 머리줄(← 시간표 · 메모 시트 · 저장됨)이 툴바가 있던 높이에 선다. 세로 스크롤은 시간표 본문만.
 */
export function TimetableSplitPanes({ top, left, right }: { top: ReactNode; left: ReactNode; right: ReactNode }) {
  return (
    <div
      id={SPLIT_ID}
      {...{ [SPLIT_X_ATTR]: "" }}
      className="timetable-split grid min-h-0 flex-1 auto-cols-[100%] grid-flow-col grid-rows-[100%] overflow-x-auto overflow-y-hidden"
    >
      {/* 툴바는 판 폭을 다 쓴다(로딩 스켈레톤·다른 뷰와 같은 폭) — 경계선 앞 여백은 본문 스크롤 상자에만. */}
      <div className="flex min-h-0 min-w-0 flex-col gap-4 compact-chrome:gap-3">
        {top}
        <div className="min-h-0 flex-1 overflow-y-auto pr-3">{left}</div>
      </div>
      <div {...{ [SHEET_PANE_ATTR]: "" }} className="border-line-strong min-h-0 border-l-2 pl-3">
        {right}
      </div>
    </div>
  );
}

/** 툴바의 '메모 시트 →' — 오른쪽 판으로 넘어간다(가로 스크롤과 같은 자리). */
export function MemoSheetJumpButton({ className }: { className: string }) {
  return (
    <button type="button" className={className} onClick={() => scrollSplitTo("sheet")}>
      메모 시트 →
    </button>
  );
}
