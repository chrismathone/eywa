"use client";

import { isSeatDragGesture } from "@/features/attendance/seat/placement";

/**
 * 자리 출석부의 **드래그 ↔ 클릭 분리** — 원장 2026-09-10 *"클릭으로 출결되는거랑 중복액션되지않게
 * 잘 분리해서"*.
 *
 * 🔴 이 화면의 학생 카드는 **누르면 출석이 찍히는 버튼**이다. 그 위에 드래그를 얹으면 끌어다 놓은
 *    직후의 `click`이 그대로 이어져 **옮기면서 출결까지 찍힌다**(브라우저는 pointerdown/up이 같은
 *    요소면 움직임과 무관하게 click을 낸다 — 시간표에서 겪은 것과 같은 함정, `drag-flag.ts`).
 * 🔑 그래서 문은 둘이다:
 *    ① **문턱** — dnd-kit `PointerSensor`의 `activationConstraint: { distance }`가 5px **초과**에서만
 *       드래그를 시작한다. 그 아래면 드래그가 아예 없고 평소처럼 클릭(출결)이 나간다.
 *    ② **직후 클릭 삼킴** — 드래그가 났으면 뒤따르는 click 한 번을 캡처 단계에서 먹는다.
 * ⚠️ 판정 기하는 순수 함수 `isSeatDragGesture`가 단일 소스다(dnd-kit과 같은 유클리드·초과) — 두
 *    기준이 갈리면 대각선으로 살짝 끈 동작에서 정확히 이중 액션이 난다.
 * ⚠️ 창(iframe)마다 별개 문서라 모듈 스코프 상태가 서로 안 섞인다.
 */

/** click은 pointerup 바로 뒤에 온다 — 넉넉히 잡으면 놓자마자 누른 **진짜 클릭**까지 먹는다. */
const CLICK_GRACE_MS = 400;

let dragging = false;
let dragEndedAt = 0;
let downAt: { x: number; y: number } | null = null;

/** dnd-kit이 실제로 드래그를 시작했다. */
export function beginSeatDrag(): void {
  dragging = true;
}

/** dnd-kit 드래그가 끝났다(놓았거나 취소). 이 시각부터 유예 동안의 click 한 번을 삼킨다. */
export function endSeatDrag(): void {
  dragging = false;
  dragEndedAt = Date.now();
}

/**
 * **문턱을 못 넘고 끝난 움직임**도 여기서 본다 — dnd-kit이 드래그를 시작조차 안 했더라도, 포인터가
 * 눈에 띄게 움직였다면 그건 "옮기려다 만" 동작이지 카드를 누른 게 아니다. 시간표의
 * `noteDragPointerUp`과 같은 규약(문턱이 없으면 클릭으로 여는 기능 자체가 죽는다).
 */
export function seatPointerDown(e: { clientX: number; clientY: number }): void {
  downAt = { x: e.clientX, y: e.clientY };
}

export function seatPointerUp(e: { clientX: number; clientY: number }): void {
  const from = downAt;
  downAt = null;
  if (!from) return;
  if (isSeatDragGesture(e.clientX - from.x, e.clientY - from.y)) dragEndedAt = Date.now();
}

/** 드래그 직후의 클릭을 삼킨다 — 카드 격자 루트의 `onClickCapture`에 단다. */
export function swallowSeatClickAfterDrag(e: { stopPropagation(): void; preventDefault(): void }): void {
  if (!dragging && (dragEndedAt === 0 || Date.now() - dragEndedAt >= CLICK_GRACE_MS)) return;
  e.stopPropagation();
  e.preventDefault();
}
