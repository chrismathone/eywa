"use client";

import type { ReactNode } from "react";

import {
  blockersText,
  classMoveBlockers,
  type ClassMoveLookup,
  type MoveSubject,
} from "@/features/timetable/lib/class-move";

/** 반 블록을 놓을 수 있는 칸 표식 — 보드가 포인터 아래 칸을 이 속성으로 찾는다(id 파싱 금지). */
export const CELL_DAY_ATTR = "data-cell-day";
export const CELL_START_ATTR = "data-cell-start";
/** 갈 수 있는 칸에만 붙는다(`"1"`) — 못 가는 칸은 아예 대상이 아니다. */
export const CELL_OK_ATTR = "data-cell-ok";
/** 포인터가 지금 올라가 있는 칸(보드가 DOM으로 직접 켜고 끈다). */
export const CELL_HOT_ATTR = "data-cell-hot";

/**
 * 격자 칸(요일 × 교시) — 반 블록의 **드롭 대상 표면**.
 *
 * 원장 2026-09-04: *"반을 콕 찝으면 그걸 계산해서 드랍 가능한 위치만 하이라이트"*. 판정은 순수 함수
 * [`classMoveBlockers`](../../../../features/timetable/lib/class-move.ts) 하나 — 학생(전 과목)·강사·강의실·같은 반 넷을 본다.
 *
 * 🔴 **이 컴포넌트는 상태를 구독하지 않는다**(원장 제보 *"반 드래그 렌더링이 상당히 오래걸리네"*).
 *    칸은 수백 개라, 집는 순간 칸마다 React를 돌리면 그 자체가 렉이다(실측 ~900ms). 그래서 칸은 **표식만 달고**
 *    (평소엔 아무 색도 없다), 반을 집으면 보드가 [`annotateDropCells`](#)로 **DOM에 직접** 판정 결과를 칠한다.
 *    dnd-kit `useDroppable`을 안 쓰는 이유도 같다 — 드롭존이 새로 생기면 전부 다시 재기 때문(집는 순간 한 프레임에 몰린다).
 * 🔴 **갈 수 있는 칸만 칠한다** — 못 가는 칸을 빨갛게 칠하면 화면 절반이 경고가 되어 아무도 안 읽는다.
 *    막힌 칸은 색 없이 이유를 `title`로만 남긴다(왜 못 가는지는 물어볼 수 있어야 한다).
 */
export function GridDropCell({
  day,
  start,
  children,
}: {
  /** 이 칸의 요일(`mon`…). */
  day: string;
  /** 이 칸 교시의 시작시각(`HH:MM:SS`) — 옮기면 이 시각으로 시작한다(길이는 원래 그대로). */
  start: string;
  children: ReactNode;
}) {
  return (
    <div
      {...{ [CELL_DAY_ATTR]: day, [CELL_START_ATTR]: start }}
      // 갈 수 있는 칸 = 눈에 **보여야** 한다 — `bg-green-soft`(이미 12% 투명)를 다시 `/60`으로 깎았더니 7%가 되어
      //    화면에서 안 보였다(원장 캡처 2026-09-04). 솔리드 초록의 투명도로 직접 잡는다(칸 10% · 포인터 위 20%).
      className="h-full rounded-[3px] data-[cell-ok]:bg-green/10 data-[cell-ok]:ring-1 data-[cell-ok]:ring-green/50 data-[cell-hot]:bg-green/20 data-[cell-hot]:ring-2 data-[cell-hot]:ring-green"
    >
      {children}
    </div>
  );
}

/**
 * 반을 집었을 때 — 칸마다 판정해 **DOM에 직접** 표식을 단다(React 렌더 0).
 * 갈 수 있으면 `data-cell-ok="1"`, 못 가면 이유를 `title`로.
 */
export function annotateDropCells(
  root: Document | HTMLElement,
  subject: MoveSubject,
  from: { day: string; start: string },
  lookup: ClassMoveLookup,
): void {
  const cells = root.querySelectorAll<HTMLElement>(`[${CELL_DAY_ATTR}]`);
  for (const el of cells) {
    const day = el.getAttribute(CELL_DAY_ATTR);
    const start = el.getAttribute(CELL_START_ATTR);
    if (!day || !start) continue;
    if (from.day === day && from.start.slice(0, 5) === start.slice(0, 5)) {
      el.removeAttribute(CELL_OK_ATTR);
      el.title = "지금 있는 자리입니다";
      continue;
    }
    const blockers = classMoveBlockers(subject, day, start, lookup);
    if (blockers.length === 0) {
      el.setAttribute(CELL_OK_ATTR, "1");
      el.title = "여기로 옮길 수 있습니다";
    } else {
      el.removeAttribute(CELL_OK_ATTR);
      el.title = blockersText(blockers);
    }
  }
}

/** 드래그가 끝나면 표식을 걷는다(평소 화면엔 아무 색도 남지 않는다). */
export function clearDropCells(root: Document | HTMLElement): void {
  for (const el of root.querySelectorAll<HTMLElement>(`[${CELL_DAY_ATTR}]`)) {
    el.removeAttribute(CELL_OK_ATTR);
    el.removeAttribute(CELL_HOT_ATTR);
    el.removeAttribute("title");
  }
}
