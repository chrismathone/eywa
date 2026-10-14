"use client";

import { useEffect, useRef } from "react";

/** 누른 자리와 뗀 자리가 이보다 멀면 클릭이 아니라 끌기로 본다(px). */
const SLOP = 10;
/** 손을 뗀 뒤 브라우저가 보내는 click을 기다리는 시간 — 터치는 click이 손 뗀 뒤 따로 온다. */
const CLICK_WAIT_MS = 1000;

/**
 * 정보창 바깥을 누르면 **정보창만 닫고 그 클릭은 아무 일도 하지 않는다**(원장 2026-10-14
 * *"바깥 클릭은 그냥 창만 닫히는걸로 멈추고 이런 액션 없이 그냥 클릭하기 전처럼"*).
 * - 누르는 순간(pointerdown)부터 뗄 때·뒤따르는 click·dblclick까지 window 캡처 단계에서 삼킨다 — 아래 버튼·링크·
 *   입력칸 초점·React 핸들러가 그 클릭을 못 본다. 다음 클릭부터는 평소대로.
 * - 터치로 스크롤하면(pointercancel)·눌러서 끌면 닫지 않는다. 스크롤바를 누른 것은 건드리지 않는다(스크롤로는 닫지 않는다).
 * - 창(iframe) 안을 누른 것은 이 문서에 오지 않는다 — 닫지 않는다.
 */
export function useOutsideDismiss(open: boolean, isInside: (target: Node) => boolean, onDismiss: () => void) {
  const latest = useRef({ isInside, onDismiss });
  useEffect(() => { latest.current = { isInside, onDismiss }; });
  useEffect(() => {
    if (!open) return;
    let press: { id: number; x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Node)) return;
      if (latest.current.isInside(event.target) || onScrollbar(event)) return;
      press = { id: event.pointerId, x: event.clientX, y: event.clientY };
      swallow(event);
    };
    const onUp = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.id) return;
      const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP;
      press = null;
      swallow(event);
      swallowFollowingClick(event.clientX, event.clientY);
      if (!moved) latest.current.onDismiss();
    };
    const onCancel = (event: PointerEvent) => { if (press?.id === event.pointerId) press = null; };
    const onMouse = (event: MouseEvent) => { if (press) swallow(event); };
    const listeners = [["pointerdown", onDown], ["pointerup", onUp], ["pointercancel", onCancel], ["mousedown", onMouse], ["mouseup", onMouse]] as const;
    for (const [type, listener] of listeners) window.addEventListener(type, listener as EventListener, true);
    return () => { for (const [type, listener] of listeners) window.removeEventListener(type, listener as EventListener, true); };
  }, [open]);
}

function swallow(event: Event) {
  event.preventDefault();
  event.stopPropagation();
}

/** 정보창이 닫혀 위 효과가 풀려도 남아야 한다 — 손 뗀 자리의 click(과 dblclick) 한 번만 삼키고 스스로 걷힌다. */
function swallowFollowingClick(x: number, y: number) {
  const near = (event: MouseEvent) => Math.hypot(event.clientX - x, event.clientY - y) <= SLOP * 2;
  const onClick = (event: MouseEvent) => {
    if (!near(event)) return;
    swallow(event);
    window.removeEventListener("click", onClick, true);
  };
  const onDouble = (event: MouseEvent) => { if (near(event)) swallow(event); };
  window.addEventListener("click", onClick, true);
  window.addEventListener("dblclick", onDouble, true);
  setTimeout(() => {
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("dblclick", onDouble, true);
  }, CLICK_WAIT_MS);
}

/** 스크롤바 위를 누른 것인가 — 스크롤바는 요소의 client 영역 밖(오른쪽·아래)에 그려진다. */
function onScrollbar(event: PointerEvent): boolean {
  const target = event.target;
  if (target === document.documentElement) {
    return event.clientX >= document.documentElement.clientWidth || event.clientY >= document.documentElement.clientHeight;
  }
  if (!(target instanceof HTMLElement) || (target.offsetWidth === target.clientWidth && target.offsetHeight === target.clientHeight)) return false;
  return event.offsetX > target.clientWidth || event.offsetY > target.clientHeight;
}
