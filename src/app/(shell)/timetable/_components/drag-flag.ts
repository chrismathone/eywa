"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

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
 * 지금 끌고 있는 **반 블록**의 판정 재료 — 보드가 `useRef`로 들고 다닌다(구독자 없음).
 * 🔴 한때 이걸 모듈 저장소 + `useSyncExternalStore`로 뒀는데, 칸을 다시 그리게 하는 순간 그게 곧 픽업 렉이라
 *    칸은 DOM 직칠(`annotateDropCells`)로 바뀌었고 구독자가 0이 됐다 — **저장소는 지웠다**(쓰기 전용 상태는
 *    다음 사람이 "누군가 구독한다"고 오해한다). 타입만 남긴다.
 */
export type ClassDragInfo = {
  /** 끌고 있는 블록의 기준 배치(스케줄) id — 저장·표식의 키. */
  slotId: string;
  classId: string;
  className: string;
  /** 출발 요일·시각(같은 자리로 떨어뜨리면 아무 일도 안 하게). */
  fromDay: string;
  fromStart: string;
  /** 판정 재료 — 실효 강사·강의실·자리 여부·함께 옮기는 줄들(class-move.ts `MoveSubject`). */
  subject: MoveSubject;
};

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

/**
 * 이 기기에 **터치·펜이 달려 있나** — hover가 없어 무장 방식을 못 쓰므로 그런 기기에선 모든 줄을 무장한다.
 *
 * 🔴 `(pointer: coarse)`가 아니라 **`(any-pointer: coarse)`** (적대 리뷰 2026-09-04) — 앞엣것은 **주** 포인터만
 *    본다. 터치스크린 + 트랙패드 노트북은 주 포인터가 fine이라 false가 되고, 손가락은 `pointerover`의
 *    `pointerType`이 "touch"라 무장도 안 걸려 **그 기기에선 학생 줄을 아예 못 끌었다**.
 * 🔴 **첫 렌더에는 false**를 돌려준다 — 서버는 이 값을 모르므로(항상 false로 그린다) 첫 클라 렌더가 다르면
 *    하이드레이션이 깨진다(이 리포엔 그것으로 화면 클릭이 통째로 죽은 전례가 둘 있다: [[#75]]·[[#108]]).
 *    마운트 뒤 한 번 재고, 그때 켜지는 기기만 다시 그린다.
 */
let touchCapable = false;
let touchProbed = false;
const touchSubscribers = new Set<() => void>();

function probeTouchCapable(): void {
  if (touchProbed) return;
  touchProbed = true;
  const next =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(any-pointer: coarse)").matches
      : false;
  if (next === touchCapable) return;
  touchCapable = next;
  for (const cb of touchSubscribers) cb();
}

function subscribeTouch(cb: () => void): () => void {
  touchSubscribers.add(cb);
  return () => {
    touchSubscribers.delete(cb);
  };
}

export function useTouchCapable(): boolean {
  useEffect(probeTouchCapable, []);
  return useSyncExternalStore(
    subscribeTouch,
    () => touchCapable,
    () => false,
  );
}
