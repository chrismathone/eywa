"use client";

import { useState, useSyncExternalStore } from "react";
import { useDndMonitor } from "@dnd-kit/core";
import type { SeatKey } from "@/features/attendance/seat/seat";
import {
  beginSeatPinCall,
  beginSeatPinClassClear,
  dropSeatPinAsk,
  EMPTY_SEAT_PIN_LEDGER,
  settleSeatPinCall,
  type SeatPinAsk,
  type SeatPinLedger,
  type SeatPinOutcome,
  type SeatPinTarget,
} from "./seat-pin-ledger";

export type { SeatPinAsk } from "./seat-pin-ledger";

/**
 * 고정 질문·교시 호출 장부·에러 한 줄의 **가게** — 문서(창) 하나에 한 벌.
 *
 * 🔴 **화면(`SeatAllDay`) state에 두지 않는다** — 질문은 서버 응답 **뒤에** 서는데, 그 사이 사람이 교시 칩·'전체' 칩·날짜
 *    화살표·자리 전환을 누르면 화면이 새로 마운트돼 **대기열째 버려졌다**(적대 리뷰 2026-09-11: 옮긴 학생을 보려고 방금 놓은
 *    칩을 누르는 게 가장 자연스러운 다음 동작인데, 그러면 '고정할까요?'가 끝내 안 떴다. 이동은 저장됐으니 다시 물을 길도
 *    없었다). 가게는 마운트와 무관하게 응답을 받아 둔다.
 * 🔑 에러 한 줄은 **누른 화면의 날짜**에 묶는다 — 다른 날로 가 있으면 그날로 돌아왔을 때 선다(다른 날 화면을 덮지 않게).
 * ⚠️ 서버 렌더에선 늘 빈 값이다(`useSyncExternalStore` 서버 스냅샷) — 쓰기는 클라 이벤트에서만 일어난다.
 */
type SeatMoveNote = { seat: SeatKey; date: string; text: string };
type SeatPinView = { asks: readonly SeatPinAsk[]; note: SeatMoveNote | null };

let ledger: SeatPinLedger = EMPTY_SEAT_PIN_LEDGER;
const EMPTY_VIEW: SeatPinView = { asks: EMPTY_SEAT_PIN_LEDGER.asks, note: null };
/** 화면이 보는 값 — 질문 줄·에러가 **바뀔 때만** 새 참조(호출 장부만 바뀌면 화면을 다시 그리지 않는다). */
let view: SeatPinView = EMPTY_VIEW;
const listeners = new Set<() => void>();

function commit(next: SeatPinLedger, note: SeatMoveNote | null = view.note) {
  ledger = next;
  if (next.asks !== view.asks || note !== view.note) view = { asks: next.asks, note };
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** 질문 줄 + 에러 한 줄 — 가게를 구독한다. */
export function useSeatPinView(): SeatPinView {
  return useSyncExternalStore(
    subscribe,
    () => view,
    () => EMPTY_VIEW,
  );
}

/** 교시 호출을 보낸다 — 그 과녁의 줄 선 질문은 숨는다(`beginSeatPinCall`). 돌려준 번호로 응답을 적는다. */
export function beginSeatPinMove(target: SeatPinTarget): number {
  const r = beginSeatPinCall(ledger, target);
  commit(r.ledger);
  return r.seq;
}

/** [해제]를 보낸다 — 그 반의 과녁 전부(`beginSeatPinClassClear`). */
export function beginSeatPinClear(scope: Pick<SeatPinTarget, "seat" | "date" | "classId">) {
  const r = beginSeatPinClassClear(ledger, scope);
  commit(r.ledger);
  return r.calls;
}

/** 응답을 적는다 — 참이면 이 응답이 그 과녁의 마지막 호출이다(낙관 반영을 되돌릴 자격). */
export function settleSeatPinMove(target: SeatPinTarget, seq: number, outcome: SeatPinOutcome): boolean {
  const r = settleSeatPinCall(ledger, target, seq, outcome);
  commit(r.ledger);
  return r.latest;
}

/** '오늘만' — 본 그 질문만 줄에서 뺀다(서버엔 아무것도 안 보낸다). */
export function closeSeatPinAsk(ask: SeatPinAsk) {
  commit({ ...ledger, asks: dropSeatPinAsk(ledger.asks, ask) });
}

/** 에러 한 줄 — 누른 화면의 (자리, 날짜)에 묶는다. null이면 걷는다. */
export function noteSeatMove(note: SeatMoveNote | null) {
  commit(ledger, note);
}

/** 테스트 전용 — 테스트마다 빈 가게로 시작한다(문서 하나에 한 벌이라 테스트 사이에 남는다). */
export function resetSeatPinStoreForTests() {
  commit(EMPTY_SEAT_PIN_LEDGER, null);
}

/**
 * 고정 질문 줄의 **창 자리** — 맨 앞 하나를 띄우고, 카드를 끄는 동안엔 띄우지 않는다.
 *
 * 🔴 끄는 도중에 창이 뜨지 않게 한다 — 질문은 왕복 뒤에 도착하므로, 다음 카드를 끄는 중에 앞 질문이 도착하면 화면을
 *    덮는 창이 끄는 손 아래서 튀어나온다. 줄에 담아 두었다가 놓은 뒤에 띄운다.
 * ⚠️ 끄는 상태는 **이 조각 안에서만** 든다(`useDndMonitor`) — `SeatAllDay`가 들면 집는 순간 교시 판 전부가 다시 그려진다.
 * ⚠️ `DndContext` 안에서만 쓴다.
 */
export function SeatPinAskHost({
  asks,
  date,
  pending,
  onClose,
  onPin,
}: {
  asks: readonly SeatPinAsk[];
  /** 지금 화면의 날짜 — 질문이 다른 날 것이면 창이 그 날짜를 적는다. */
  date: string;
  pending: boolean;
  onClose: (ask: SeatPinAsk) => void;
  onPin: (ask: SeatPinAsk) => void;
}) {
  const [dragging, setDragging] = useState(false);
  useDndMonitor({
    onDragStart: () => setDragging(true),
    onDragEnd: () => setDragging(false),
    onDragCancel: () => setDragging(false),
  });
  const ask = asks[0];
  if (!ask || dragging) return null;
  return (
    <SeatPinAskDialog
      ask={ask}
      otherDay={ask.date !== date}
      pending={pending}
      onClose={() => onClose(ask)}
      onPin={() => onPin(ask)}
    />
  );
}

/** "9월 11일 (금)" — 페이지 헤더 날짜와 같은 모양. */
function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", month: "long", day: "numeric", weekday: "short" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/**
 * **고정 확인 창** — 원장 2026-09-10 *"한번 드래그한 학생은 '다음에도 이 LAB실 수업을 이 시간대로 고정할까요?'라고
 * 물어볼것"*.
 *
 * 🔴 창은 **고정만** 묻는다 — 그날 이동은 이미 됐다. 닫아도 안 되돌아가는 이유를 문장이 말한다.
 * 🔑 다른 날의 질문(그 사이 날짜를 옮겼다)이면 **그 날짜를 적고** '그날만'이라 부른다 — 답은 그날로 간다.
 */
export function SeatPinAskDialog({
  ask,
  otherDay = false,
  pending,
  onClose,
  onPin,
}: {
  ask: SeatPinAsk;
  otherDay?: boolean;
  pending: boolean;
  onClose: () => void;
  onPin: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-card shadow-card w-full max-w-sm rounded-2xl p-4">
        <p className="text-foreground text-sm font-bold">다음에도 이 자리 수업을 {ask.toSlot}로 고정할까요?</p>
        <p className="text-text-dim mt-2 text-xs leading-relaxed">
          {otherDay ? `${dayLabel(ask.date)} ` : null}
          {ask.name} 학생을 {ask.fromSlot} → {ask.toSlot}로 옮겼습니다({otherDay ? "그날" : "오늘"} 명단에 이미 반영됨).
          고정하면 앞으로 같은 요일에는 {ask.toSlot} 명단에만 섭니다. 지난 날짜와 출결 기록은 바뀌지 않습니다.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="border-line text-text-dim rounded-lg border px-3 py-1.5 text-xs font-semibold"
          >
            {otherDay ? "그날만" : "오늘만"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onPin}
            className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            앞으로도 고정
          </button>
        </div>
      </div>
    </div>
  );
}
