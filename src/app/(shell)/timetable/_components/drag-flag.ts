"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { MoveSubject } from "@/features/timetable/lib/class-move";

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
export function setTimetableDragging(next: boolean, kind: "student" | "class" = "student"): void {
  // 🔴 **끌고 있는 것이 무엇인지**를 함께 알린다 — 학생용 표식(요일 칸 머리·'여기로')이 반을 끌 때도 뜨면
  //    "반인데 왜 학생처럼 움직이지"가 된다(원장 캡처 2026-09-04). 화면 장식은 종류별 클래스를 본다.
  if (typeof document !== "undefined") {
    document.body.classList.toggle("tt-dragging", next);
    document.body.classList.toggle("tt-dragging-student", next && kind === "student");
    document.body.classList.toggle("tt-dragging-class", next && kind === "class");
  }
  if (dragging === next) return;
  dragging = next;
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

/**
 * 지금 끌고 있는 **반 블록**(반 이름 머리를 잡았을 때) — 격자 칸이 "여기로 갈 수 있나"를 판정하는 재료.
 *
 * 🔴 학생 드래그와 같은 이유로 **컨텍스트가 아니다**(픽업 렉) — 다만 칸 하이라이트는 다시 그려야 하므로
 *    칸 컴포넌트만 `useClassDrag()`로 구독한다. 반을 집는 것은 드문·의도적 동작이라 그때 한 번 도는 비용은 받는다.
 */
export type ClassDragInfo = {
  /** 끌고 있는 배치(스케줄) id — 저장은 이 행을 옮긴다. */
  slotId: string;
  classId: string;
  className: string;
  /** 출발 요일·시각(같은 자리로 떨어뜨리면 아무 일도 안 하게). */
  fromDay: string;
  fromStart: string;
  /** 판정 재료 — 실효 강사·강의실·자리 여부·원래 길이(class-move.ts `MoveSubject`). */
  subject: MoveSubject;
};

let classDrag: ClassDragInfo | null = null;
const classSubscribers = new Set<() => void>();

/** DnD 영역이 반 블록 드래그의 시작·끝에 부른다. */
export function setClassDrag(next: ClassDragInfo | null): void {
  if (classDrag === next) return;
  classDrag = next;
  for (const cb of classSubscribers) cb();
}

function subscribeClass(cb: () => void): () => void {
  classSubscribers.add(cb);
  return () => {
    classSubscribers.delete(cb);
  };
}

/** 지금 끌고 있는 반 블록(없으면 null) — 격자 칸이 구독한다. */
export function useClassDrag(): ClassDragInfo | null {
  return useSyncExternalStore(
    subscribeClass,
    () => classDrag,
    () => null,
  );
}

/**
 * **마우스가 올라간 줄만 드래그 장치를 단다**(원장 제보 2026-09-04 *"픽업할 때 렉"* 후속).
 *
 * 🔴 왜: `useDraggable`은 dnd-kit 컨텍스트를 구독한다 — 집는 순간 `active`가 바뀌면서 그 훅을 쓰는 **모든 줄**
 *    (이 화면 348줄)이 한꺼번에 다시 그려진다. 실측상 픽업의 남은 비용이 거의 그것이었다(동기 1ms · 뒤이은
 *    비동기 작업 ~600ms, 최장 롱태스크 610ms). 마우스는 **누르기 전에 반드시 그 줄 위를 지난다** — 그때
 *    한 줄만 무장시키면 드래그 능력은 그대로면서 훅이 1개로 준다.
 * ⚠️ **터치·펜(거친 포인터)엔 hover가 없다** → 그 기기에선 지금까지처럼 모든 줄을 무장시킨다(느려도 되는 쪽이
 *    아니라, 안 되면 아예 못 옮기는 쪽이라서). 판정은 `matchMedia("(pointer: coarse)")` 한 번.
 * ⚠️ 무장 줄과 평소 줄은 **같은 DOM**을 그린다(student-rows.tsx) — 다르면 마우스가 지날 때마다 줄이 움찔한다.
 */
let armedRow: string | null = null;
const armedSubscribers = new Set<() => void>();

export function setArmedRow(key: string | null): void {
  if (armedRow === key) return;
  armedRow = key;
  for (const cb of armedSubscribers) cb();
}

function subscribeArmed(cb: () => void): () => void {
  armedSubscribers.add(cb);
  return () => {
    armedSubscribers.delete(cb);
  };
}

/** 이 줄이 지금 무장 상태인가 — 값이 바뀐 줄만 다시 그려진다(나머지는 스냅샷 비교에서 걸러진다). */
export function useIsArmedRow(key: string): boolean {
  const get = useCallback(() => armedRow === key, [key]);
  return useSyncExternalStore(subscribeArmed, get, () => false);
}

/** 거친 포인터(터치·펜) 기기인가 — hover가 없어 무장 방식을 못 쓴다. 창마다 한 번만 잰다. */
let coarsePointer: boolean | null = null;
export function isCoarsePointer(): boolean {
  if (coarsePointer === null) {
    coarsePointer =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(pointer: coarse)").matches
        : false;
  }
  return coarsePointer;
}
