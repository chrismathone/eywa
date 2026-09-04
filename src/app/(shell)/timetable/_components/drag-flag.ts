"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * "지금 시간표에서 뭔가를 끌고 있다"를 **React 상태 밖**에 두는 플래그.
 *
 * 🔴 왜 컨텍스트가 아닌가(원장 제보 2026-09-04 *"처음 학생을 마우스로 클릭해서 픽업할 때 렉 걸림"*):
 *    끄는 중 여부를 `TimetableEditContext` 값에 넣었더니, 집는 **그 순간** 컨텍스트가 바뀌어 그 값을 읽는
 *    모든 것(셀 59 + 학생 줄 350)이 한꺼번에 다시 그려졌다. CPU 프로파일에서 픽업 구간의 상위가 전부 React
 *    커밋(`recursivelyTraverseMutationEffects` 9.6% · `jsxDEV` 9% · `commitMutationEffectsOnFiber` 6%)이었다.
 *    → 화면 장식은 **CSS**(`body.tt-dragging` + `[.tt-dragging_&]:` 변형)로, 로직은 이 플래그로 읽는다.
 *      그러면 픽업에 드는 React 일은 dnd-kit 자신의 것뿐이다.
 * ⚠️ 정말 다시 그려야 하는 소비처(빈 교시 임시 펼침·검색 해제)만 `useTimetableDragging(enabled)`로 **구독**한다.
 *    `enabled`가 false면 구독조차 안 걸어서(접힘 없음·검색어 없음 = 평소) 그 컴포넌트는 픽업에 안 깨어난다.
 * ⚠️ 창(iframe)마다 별개 문서라 모듈 스코프 플래그가 서로 안 섞인다(`timetable-unsaved.ts`와 같은 이유).
 */
let dragging = false;
const subscribers = new Set<() => void>();

/** DnD 영역이 드래그 시작·끝에 부른다. body 클래스도 여기서 함께 갈아 화면 장식이 따라오게 한다. */
export function setTimetableDragging(next: boolean): void {
  if (dragging === next) return;
  dragging = next;
  if (typeof document !== "undefined") document.body.classList.toggle("tt-dragging", next);
  for (const cb of subscribers) cb();
}

/** 지금 끌고 있나 — 렌더 밖(이벤트 핸들러)에서 읽는 용도(hover 카드 억제 등). */
export function isTimetableDragging(): boolean {
  return dragging;
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

const noSubscribe = () => () => {};

/**
 * 끌고 있는지 **구독**한다 — 값이 바뀌면 이 컴포넌트만 다시 그린다.
 * @param enabled false면 구독하지 않고 항상 false를 돌려준다(그 화면엔 이 신호가 필요 없다는 뜻).
 */
export function useTimetableDragging(enabled = true): boolean {
  const get = useCallback(() => (enabled ? dragging : false), [enabled]);
  return useSyncExternalStore(enabled ? subscribe : noSubscribe, get, () => false);
}
