"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  closestCenter,
  DragOverlay,
  pointerWithin,
  useDndContext,
  useDndMonitor,
  useDroppable,
  type CollisionDetection,
} from "@dnd-kit/core";
import { DRAG_BLOCKED_ATTR } from "@/features/timetable/lib/grid-attrs";
import { seatDragHint, type SeatDropVerdict } from "@/features/attendance/seat/drop-verdict";
import type { SeatPeriodChipProps } from "./seat-period-chips";
import { SeatDragCard, type CardDrag, type SeatDropTarget } from "./seat-lab-grid";

/**
 * '다른 시간으로 옮기기' 드래그의 **놓을 곳**(교시 칩 · 교시 판)과 끄는 카드 — 원장 2026-09-11 *"LAB실에서 내가
 * 드래그하고 싶은건, '다른 시간대'의 수업임"* · *"아니 드래그는 '전체' 에서도 다른 시간으로 이동하려고하면 경고 문구
 * 뜨면서 안됨"*.
 *
 * 🔑 **집는 순간 놓을 곳마다 가부를 먼저 칠한다** — 되는 곳 = 초록(시간표 드롭 칸과 같은 색) · 안 되는 곳 = 붉은 빗금
 *    (`[data-drag-blocked]`, 시간표와 같은 표식·그림은 globals.css 한 곳) + 교시 판엔 이유 한 줄 · 제자리(같은 시간) =
 *    빗금 없음(취소지 금지 구역이 아니다). 놓고 나서야 이유를 보던 것이 원장이 본 "경고 문구 뜨면서 안 됨"이었다.
 * 🔑 판정은 `SeatAllDay`가 넘기는 `verdictOf` **하나**([`seatDropVerdict`](@/features/attendance/seat/drop-verdict.ts))
 *    — 끄는 카드 아래 문장·드롭 거절과 같은 함수·같은 문장이다.
 * 🔴 **끄는 상태를 넓은 곳에 두지 않는다** — 끄는 카드는 이 파일의 작은 제공자(`SeatDragProvider`)가 들고, 가부는 놓을 곳
 *    껍데기 안에서만 계산한다. 안의 교시 판은 부모(`SeatAllDay`)가 만든 **같은 요소**라 제공자·껍데기가 다시 그려져도
 *    React가 건너뛴다(시간표 결정 *"드래그 상태를 넓은 컨텍스트에 넣지 말 것"*과 같은 결).
 * ⚠️ 그래도 카드마다 `useDraggable`이 dnd 컨텍스트(`active`·`over`)를 구독해서, 집을 때·칸을 넘을 때마다 **카드 껍데기는**
 *    전부 다시 불린다 — 무거운 본문(출결 버튼·사유 팝업·신호 줄)은 `memo`라 건너뛰고 끄는 카드 한 장만 다시 그려진다
 *    ([`seat-lab-grid.tsx`](./seat-lab-grid.tsx) `SeatCardBody`).
 */

export type SeatVerdictOf = (card: CardDrag, toSlot: string) => SeatDropVerdict;

/** 놓을 곳 id 앞자락 — 충돌 판정이 칩과 교시 판을 가른다(판정 재료는 여전히 드롭 `data`의 교시뿐이다). */
const CHIP_ID = "seat-drop-chip:";
const PERIOD_ID = "seat-drop-period:";

/**
 * 놓을 곳 = **포인터 아래**(`pointerWithin` — 끄는 카드가 칩보다 커서, 겹친 넓이로 고르면 칩을 겨눠도 아래 판이 이긴다).
 * 🔴 **칩이 이긴다**, 그리고 교시 판은 **판 상자(`boards`) 안 = 보이는 자리에서만** 받는다 — dnd-kit `Rect`는 스크롤만
 *    보정하고 가려진 부분을 잘라내지 않는다. '전체' 보기에서 명단을 내려 두면 위로 스크롤돼 안 보이는 교시 판의 사각형이
 *    칩 줄 위를 그대로 덮어서, 칩 사이 틈·빈 레일·'전체' 칩·에러 줄에 놓으면 **보이지도 않는 교시로** 옮겨졌다
 *    (적대 리뷰 2026-09-11).
 * ⚠️ 판 상자를 못 찾으면 판을 받지 않는다 — 겨누지 않은 교시에 쓰는 것보다 아무 일도 없는 쪽이 낫다(칩은 그대로 된다).
 */
export function seatDropCollision(
  args: Parameters<CollisionDetection>[0],
  boards: Element | null,
): ReturnType<CollisionDetection> {
  const p = args.pointerCoordinates;
  if (!p) return closestCenter(args);
  const hits = pointerWithin(args);
  const chips = hits.filter((c) => String(c.id).startsWith(CHIP_ID));
  if (chips.length > 0) return chips;
  const box = boards?.getBoundingClientRect();
  const inBoards = !!box && box.left <= p.x && p.x <= box.right && box.top <= p.y && p.y <= box.bottom;
  return inBoards ? hits : hits.filter((c) => !String(c.id).startsWith(PERIOD_ID));
}

/** 드래그 판정 재료 + 지금 끄는 카드. 옮기기가 잠긴 화면(공개 PIN·지난 날짜)에선 null이라 놓을 곳이 아예 안 켜진다. */
const SeatDropContext = createContext<{ verdictOf: SeatVerdictOf; card: CardDrag | null } | null>(null);

/** 끄는 데이터가 카드 모양인가 — 끌던 카드가 언마운트되면 dnd-kit `data`가 빈다([[#129]]). */
function isCardDrag(v: unknown): v is CardDrag {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as CardDrag).studentId === "string" &&
    typeof (v as CardDrag).start === "string"
  );
}

/**
 * 끄는 카드를 **집는 순간 한 번** 붙잡아 둔다 — 놓을 곳·끄는 카드 문장이 같은 카드를 본다.
 * ⚠️ `DndContext` 안에서만 쓴다(`useDndMonitor`).
 */
export function SeatDragProvider({ verdictOf, children }: { verdictOf: SeatVerdictOf | null; children: ReactNode }) {
  const [card, setCard] = useState<CardDrag | null>(null);
  useDndMonitor({
    onDragStart: (e) => {
      const data = e.active.data.current;
      setCard(isCardDrag(data) ? data : null);
    },
    onDragEnd: () => setCard(null),
    onDragCancel: () => setCard(null),
  });
  const value = useMemo(() => (verdictOf ? { verdictOf, card } : null), [verdictOf, card]);
  return <SeatDropContext.Provider value={value}>{children}</SeatDropContext.Provider>;
}

/** 놓을 곳 하나 — 드롭 데이터는 **교시만**이다(떨군 묶음의 반은 보지 않는다, `validateSeatPeriodMove`). */
function useSeatDrop(id: string, start: string) {
  const ctx = useContext(SeatDropContext);
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { start } satisfies SeatDropTarget,
    disabled: !ctx,
  });
  const verdict = ctx?.card ? ctx.verdictOf(ctx.card, start) : null;
  return { setNodeRef, isOver, verdict };
}

/** 막히면 빗금 표식(시간표와 같은 속성), 그 밖엔 판정 종류만 남긴다(끄는 중이 아니면 둘 다 없다). */
function dropAttrs(verdict: SeatDropVerdict | null) {
  return {
    "data-seat-drop": verdict?.kind,
    [DRAG_BLOCKED_ATTR]: verdict?.kind === "blocked" ? "1" : undefined,
  };
}

/** 되는 곳의 초록 — 시간표 드롭 칸(`grid-drop-cell.tsx`)과 같은 값. 테두리는 안쪽(칩 줄이 가로 스크롤이라 바깥 링이 잘린다, [[#114]]). */
const OK = "bg-green/10 ring-1 ring-inset ring-green/50";
const OK_OVER = "bg-green/20 ring-2 ring-inset ring-green";

/** 교시 칩 = 놓을 곳(칩에 놓으면 그 교시로) — `SeatPeriodChips`가 칩 조각으로 끼운다. 누르면 여전히 그 교시로 간다. */
export function SeatDropChip({ start, href, className, children }: SeatPeriodChipProps) {
  const { setNodeRef, isOver, verdict } = useSeatDrop(`seat-drop-chip:${start}`, start);
  const tone = verdict?.kind === "ok" ? (isOver ? OK_OVER : OK) : "";
  return (
    <Link ref={setNodeRef} href={href} data-seat-drop-start={start} {...dropAttrs(verdict)} className={`${className} ${tone}`}>
      {children}
    </Link>
  );
}

const PILL: Record<SeatDropVerdict["kind"], string> = {
  ok: "border-green text-green",
  blocked: "border-att-absent text-att-absent-ink",
  same: "border-line text-text-dim",
};

/**
 * 교시 판 = 놓을 곳('전체' 보기에선 그 교시의 어디에 놓든 그 교시로) — 끄는 동안 **이유 한 줄**을 판 위에 띄운다.
 * ⚠️ 표식은 전부 절대배치·`pointer-events-none`이다 — 집는 순간 판이 밀리면(레이아웃 이동) 겨누던 자리가 도망가고,
 *    포인터를 먹으면 드롭 판정이 죽는다.
 */
export function SeatPeriodDropZone({
  start,
  className,
  children,
}: {
  start: string;
  className: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver, verdict } = useSeatDrop(`seat-drop-period:${start}`, start);
  return (
    <div ref={setNodeRef} data-seat-drop-start={start} {...dropAttrs(verdict)} className={`relative ${className}`}>
      {children}
      {verdict?.kind === "ok" ? (
        <span aria-hidden className={`pointer-events-none absolute inset-0 z-[5] rounded-2xl ${isOver ? OK_OVER : OK}`} />
      ) : null}
      {verdict ? (
        <span
          className={`bg-card pointer-events-none absolute top-2 right-3 z-[6] max-w-[70%] rounded-full border px-2.5 py-0.5 text-xs font-semibold break-keep ${PILL[verdict.kind]}`}
        >
          {verdict.text}
        </span>
      ) : null}
    </div>
  );
}

/**
 * 끄는 카드 + 그 아래 한 줄 — 포인터 아래 놓을 곳의 판정을 **그대로** 옮겨 적는다(`seatDragHint`).
 * 🔑 놓을 곳(`over`)을 이 조각 안에서만 읽는다 — `SeatAllDay`에 두면 칸을 넘을 때마다 교시 판 전부가 다시 그려진다.
 */
export function SeatAllDayDragOverlay() {
  const ctx = useContext(SeatDropContext);
  const { over } = useDndContext();
  const card = ctx?.card ?? null;
  const toStart = (over?.data.current as Partial<SeatDropTarget> | undefined)?.start;
  const hint = card && ctx ? seatDragHint(toStart ? ctx.verdictOf(card, toStart) : null) : null;
  return <DragOverlay dropAnimation={null}>{card ? <SeatDragCard drag={card} hint={hint} /> : null}</DragOverlay>;
}
