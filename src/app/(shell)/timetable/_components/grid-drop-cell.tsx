"use client";

import type { ReactNode } from "react";

import {
  CELL_COL_ATTR,
  CELL_DAY_ATTR,
  CELL_DAYIDX_ATTR,
  CELL_DAYS_ATTR,
  CELL_GRID_ATTR,
  CELL_HOT_ATTR,
  CELL_OK_ATTR,
  CELL_ROW_ATTR,
  CELL_START_ATTR,
  GRID_ID_ATTR,
  GRID_ROWS_ATTR,
} from "@/features/timetable/lib/grid-attrs";
import {
  blockersText,
  classMoveBlockers,
  placeBlock,
  type ClassMoveLookup,
  type MoveSubject,
  type MoveTarget,
  type PlacedWindow,
} from "@/features/timetable/lib/class-move";

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
 * 🔴 **칸은 자기 좌표를 알고 있어야 한다** — 화면의 한 블록이 실제로는 배치 여러 줄이라(연속 교시·월목 병합)
 *    "그 아래 교시"·"그 옆 요일"이 있어야 놓을 수 있다. 그래서 표·행·그룹 요일까지 속성으로 싣는다.
 */
export function GridDropCell({
  day,
  start,
  grid,
  rowIndex,
  groupDays,
  col,
  children,
}: {
  /** 이 칸의 요일(`mon`…). */
  day: string;
  /** 이 칸 교시의 시작시각(`HH:MM:SS`) — 옮기면 이 시각으로 시작한다(길이는 원래 그대로). */
  start: string;
  /** 이 칸이 속한 표(평일·주말) — 교시 행 목록의 범위. */
  grid: string;
  /** 이 표에서 이 칸의 교시 행 번호(0부터). */
  rowIndex: number;
  /** 이 칸이 속한 요일 그룹의 요일들(예 `["mon","thu"]`). */
  groupDays: readonly string[];
  /** 이 칸의 열 묶음(그룹:강사) — 같은 요일·교시 칸이 강사마다 있어서 이웃 칸을 고를 때 필요하다. */
  col: string;
  children: ReactNode;
}) {
  const dayIndex = groupDays.indexOf(day);
  return (
    <div
      {...{
        [CELL_DAY_ATTR]: day,
        [CELL_START_ATTR]: start,
        [CELL_GRID_ATTR]: grid,
        [CELL_ROW_ATTR]: String(rowIndex),
        [CELL_DAYS_ATTR]: groupDays.join(","),
        [CELL_DAYIDX_ATTR]: String(dayIndex),
        [CELL_COL_ATTR]: col,
      }}
      // 갈 수 있는 칸 = 눈에 **보여야** 한다 — `bg-green-soft`(이미 12% 투명)를 다시 `/60`으로 깎았더니 7%가 되어
      //    화면에서 안 보였다(원장 캡처 2026-09-04). 솔리드 초록의 투명도로 직접 잡는다(칸 10% · 포인터 위 20%).
      className="h-full rounded-[3px] data-[cell-ok]:bg-green/10 data-[cell-ok]:ring-1 data-[cell-ok]:ring-green/50 data-[cell-hot]:bg-green/20 data-[cell-hot]:ring-2 data-[cell-hot]:ring-green"
    >
      {children}
    </div>
  );
}

/** 이 칸의 좌표(속성에서 읽은 것) — 판정·하이라이트가 함께 쓴다. */
type CellCoord = {
  el: HTMLElement;
  grid: string;
  col: string;
  day: string;
  rowIndex: number;
  groupDays: string[];
  dayIndex: number;
};

function readCoord(el: HTMLElement): CellCoord | null {
  const day = el.getAttribute(CELL_DAY_ATTR);
  const grid = el.getAttribute(CELL_GRID_ATTR);
  const row = el.getAttribute(CELL_ROW_ATTR);
  const days = el.getAttribute(CELL_DAYS_ATTR);
  const dayIdx = el.getAttribute(CELL_DAYIDX_ATTR);
  if (!day || !grid || row === null || !days || dayIdx === null) return null;
  const rowIndex = Number(row);
  const dayIndex = Number(dayIdx);
  if (!Number.isFinite(rowIndex) || !Number.isFinite(dayIndex) || dayIndex < 0) return null;
  return { el, grid, col: el.getAttribute(CELL_COL_ATTR) ?? "", day, rowIndex, groupDays: days.split(","), dayIndex };
}

/**
 * 표(평일·주말)별 교시 행 시작시각 — **표가 직접 들고 있는 목록**을 읽는다.
 * 🔴 칸에서 되짚지 말 것: 모든 열이 위쪽 rowSpan에 덮인 행은 칸이 하나도 없어 그 행이 배열에서 빠지고,
 *    두 교시를 쓰는 블록이 "여기엔 안 들어간다"로 잘못 잠긴다.
 */
function rowStartsOf(root: Document | HTMLElement, grid: string): string[] {
  const table = root.querySelector<HTMLElement>(`[${GRID_ID_ATTR}="${grid}"]`);
  const raw = table?.getAttribute(GRID_ROWS_ATTR) ?? "";
  return raw ? raw.split(",") : [];
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
  const cells: CellCoord[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(`[${CELL_DAY_ATTR}]`)) {
    const c = readCoord(el);
    if (c) cells.push(c);
  }
  const rowStarts = new Map<string, string[]>();
  for (const c of cells) if (!rowStarts.has(c.grid)) rowStarts.set(c.grid, rowStartsOf(root, c.grid));
  for (const c of cells) {
    const el = c.el;
    const target: MoveTarget = {
      groupDays: c.groupDays,
      dayIndex: c.dayIndex,
      rowStarts: rowStarts.get(c.grid) ?? [],
      rowIndex: c.rowIndex,
    };
    // 🔴 "지금 있는 자리"는 **칸의 시각**이 아니라 **놓았을 때 기준 줄이 갈 자리**로 가른다 — 반교시 확장
    //    블록은 칸 앵커(윗 교시)와 실제 슬롯(아랫 교시)이 한 칸 어긋나 있어서, 칸 시각으로 비교하면
    //    제자리도 "옮길 수 있다"가 된다(적대 리뷰 2026-09-04).
    const placed = placeBlock(subject, target);
    const anchorAt = placed?.find((w) => w.slotId === subject.slotId) ?? placed?.[0];
    if (anchorAt && anchorAt.day === from.day && anchorAt.start.slice(0, 5) === from.start.slice(0, 5)) {
      el.removeAttribute(CELL_OK_ATTR);
      el.title = "지금 있는 자리입니다";
      continue;
    }
    const blockers = classMoveBlockers(subject, target, lookup);
    if (blockers.length === 0) {
      el.setAttribute(CELL_OK_ATTR, "1");
      // ⚠️ 격자의 열 축은 **강사**인데 옮겨도 담당은 그대로다(요일·시각만 바뀐다) — 남의 강사 열에 놓으면
      //    저장 뒤 제 강사 열로 돌아간다. 그 사실을 미리 적어 둔다(적대 리뷰 2026-09-04).
      el.title = "여기로 옮길 수 있습니다 · 담당·강의실은 그대로입니다";
    } else {
      el.removeAttribute(CELL_OK_ATTR);
      el.title = blockersText(blockers);
    }
  }
}

/** 그 칸에 놓으면 각 배치가 어디로 가는가(놓을 수 없으면 null) — 드롭·마커가 같은 답을 쓴다. */
export function placementAt(el: HTMLElement, subject: MoveSubject, root: Document | HTMLElement): PlacedWindow[] | null {
  const c = readCoord(el);
  if (!c) return null;
  return placeBlock(subject, {
    groupDays: c.groupDays,
    dayIndex: c.dayIndex,
    rowStarts: rowStartsOf(root, c.grid),
    rowIndex: c.rowIndex,
  });
}

/**
 * 포인터가 올라간 칸 — 블록이 **차지할 칸 전부**를 켠다(월목 병합 블록은 두 칸이 함께 켜진다).
 * 🔴 한 칸만 켜면 두 요일을 쓰는 블록이 한 요일만 가는 것처럼 보인다(실제로는 옆 요일도 함께 옮겨진다).
 */
export function markHotCells(root: Document | HTMLElement, el: HTMLElement | null, subject: MoveSubject | null): void {
  for (const e of root.querySelectorAll<HTMLElement>(`[${CELL_HOT_ATTR}]`)) e.removeAttribute(CELL_HOT_ATTR);
  if (!el) return;
  el.setAttribute(CELL_HOT_ATTR, "1");
  if (!subject || subject.parts.length <= 1) return;
  const here = readCoord(el);
  if (!here) return;
  // 같은 열 묶음(그룹:강사) 안에서만 이웃 칸을 찾는다 — 같은 요일·교시 칸이 강사마다 있어서
  // 아무 칸이나 켜면 남의 열이 켜진다.
  const byKey = new Map<string, HTMLElement>();
  for (const e of root.querySelectorAll<HTMLElement>(`[${CELL_DAY_ATTR}]`)) {
    const c = readCoord(e);
    if (c) byKey.set(`${c.grid}|${c.col}|${c.rowIndex}|${c.day}`, e);
  }
  for (const p of subject.parts) {
    if (p.rowOffset === 0 && p.dayOffset === 0) continue;
    const day = here.groupDays[here.dayIndex + p.dayOffset];
    if (!day) continue;
    const other = byKey.get(`${here.grid}|${here.col}|${here.rowIndex + p.rowOffset}|${day}`);
    if (other) other.setAttribute(CELL_HOT_ATTR, "1");
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
