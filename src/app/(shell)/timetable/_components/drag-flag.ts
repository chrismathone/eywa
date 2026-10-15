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
  if (!next) dragEndedAt = Date.now();
  dragging = next;
  for (const cb of subscribers) cb();
}

/** 지금 끌고 있나 — 렌더 밖(이벤트 핸들러)에서 읽는 용도(hover 카드 억제 등). */
export function isTimetableDragging(): boolean {
  return dragging;
}

/**
 * 드래그 **직후의 더블클릭**을 삼킨다(원장 2026-09-09 *"드래그하다가 더블클릭이 발생하지 않도록 뭔가 조정"*).
 *
 * 🔴 왜: 크롬은 더블클릭을 **요소가 아니라 시간·좌표**로 센다 — 짧게 끌다 제자리(또는 막힌 칸)에 놓고 곧바로 다시
 *    잡으면 두 번째 pointerup이 더블클릭이 되어 학생·반 창이 열린다. 끌고 있는 중이거나 끝난 지 얼마 안 됐으면
 *    그 더블클릭은 "열기"가 아니라 드래그의 잔향이다. dnd-kit은 pointerup에서 드래그를 끝내고 그 뒤에 click·dblclick이
 *    오므로, 끝난 시각으로 판정한다(창 열기 자체는 WindowLink `openOn="doubleClick"` 그대로 — 여기선 잡아먹기만 한다).
 * ⚠️ 유예는 OS 더블클릭 간격(윈도우 기본 500ms)보다 조금 길게 — 두 번째 누름이 그 안에 와야 더블클릭이 되므로
 *    이보다 늦은 더블클릭은 진짜 더블클릭이다.
 * 사용 = DnD 영역 루트의 `onDoubleClickCapture`(캡처라 안쪽 WindowLink 핸들러 앞에서 멈춘다).
 */
export const DRAG_DBLCLICK_GRACE_MS = 700;
let dragEndedAt = 0;

export function swallowDoubleClickAfterDrag(e: { stopPropagation(): void; preventDefault(): void }): void {
  if (!dragging && (dragEndedAt === 0 || Date.now() - dragEndedAt >= DRAG_DBLCLICK_GRACE_MS)) return;
  e.stopPropagation();
  e.preventDefault();
}

/**
 * **끌었다가 제자리에 놓기**도 드래그로 친다 — 원장 제보 2026-09-09 *"드래그 후 그 위치 그대로 놓을때
 * 더블클릭으로 인식하네. 취소가 안되고?"*.
 *
 * 🔴 위 `dragEndedAt`은 **dnd-kit이 실제로 드래그를 시작했을 때만** 찍힌다. 그런데 살짝 잡았다 제자리에
 *    놓으면 활성화 문턱(거리)을 못 넘어 드래그가 시작조차 안 되고, 브라우저에는 **평범한 클릭**으로 남는다.
 *    그걸 두 번 하면 크롬이 더블클릭으로 세어 반 정보 창이 열린다(놓은 자리는 그대로인데 창만 뜬다).
 * 🔑 가르는 기준은 **움직였는가**다 — 진짜 더블클릭은 두 번 다 제자리(0~1px)지만, 끌었다 놓으면 그 사이
 *    포인터가 움직인다. 그래서 `DRAG_MOVE_EPSILON`px 넘게 움직인 pointerup만 "드래그가 끝났다"로 친다
 *    (문턱이 없으면 더블클릭으로 창을 여는 기능 자체가 통째로 죽는다).
 * 사용 = DnD 영역 루트의 `onPointerDownCapture`/`onPointerUpCapture`(더블클릭 삼킴과 같은 자리).
 */
export const DRAG_MOVE_EPSILON = 4;

/**
 * 드래그 **직후의 클릭**을 삼킨다 — 시간표 상세가 2026-09-09부터 **한 번 클릭**으로 열리기 때문이다
 * (원장 *"그냥 클릭으로 바꿔줘. 더블클릭으로 작동하는걸 그냥 클릭으로. 대신 드래그와 안겹쳐지게 조심해서"*).
 *
 * 🔴 클릭으로 열면 **끌었다 놓는 동작도 클릭으로 끝난다** — 브라우저는 pointerdown/up이 같은 요소면
 *    움직임과 무관하게 click을 낸다. 그대로 두면 학생을 옮길 때마다 상세 창이 함께 열린다.
 * 🔑 가르는 기준은 더블클릭 삼킴과 **같다** — 움직였으면 드래그, 제자리면 클릭(`noteDragPointerUp`).
 * ⚠️ 유예는 짧게: click은 pointerup 바로 뒤에 오므로 400ms면 충분하고, 길면 놓자마자 누른 **진짜 클릭**까지 먹는다.
 */
export const DRAG_CLICK_GRACE_MS = 400;

export function swallowClickAfterDrag(e: { stopPropagation(): void; preventDefault(): void }): void {
  if (!dragging && (dragEndedAt === 0 || Date.now() - dragEndedAt >= DRAG_CLICK_GRACE_MS)) return;
  e.stopPropagation();
  e.preventDefault();
}
let pointerDownAt: { x: number; y: number } | null = null;

export function noteDragPointerDown(e: { clientX: number; clientY: number }): void {
  pointerDownAt = { x: e.clientX, y: e.clientY };
}

export function noteDragPointerUp(e: { clientX: number; clientY: number }): void {
  const from = pointerDownAt;
  pointerDownAt = null;
  if (!from) return;
  const moved =
    Math.abs(e.clientX - from.x) >= DRAG_MOVE_EPSILON || Math.abs(e.clientY - from.y) >= DRAG_MOVE_EPSILON;
  if (moved) dragEndedAt = Date.now();
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

/**
 * **눌린 포인터가 무장 줄을 잡고 있는 동안** 무장을 다른 줄로 넘기지 않는다.
 *
 * 🔴 왜(원장 제보 2026-09-09 *"드래그 이동하려고 하니까 '출발 반을 알 수 없어서 옮기지 못했다'는 알림"*): 끄는
 *    동안 고스트는 `pointer-events:none`이라 포인터가 지나는 **다른 줄**의 `pointerover`가 그대로 불린다 → 그 줄이
 *    무장되고 원래 줄은 평소 줄로 돌아가 `useDraggable`이 **언마운트** → dnd-kit이 `active.data`를 빈 객체로
 *    바꾼다(core.esm "It's possible for the active node to unmount while dragging" → defaultData). 놓는 순간
 *    출발 반·수강 id가 전부 사라져 거절로 떨어졌다. 학생 줄이 빽빽한 수학 기본뷰에선 거의 매번이다.
 * ⚠️ `dragging` 플래그만으론 부족하다 — 활성화 문턱(5px) **앞**(pointerdown~드래그 시작)에도 같은 일이 난다.
 *    그래서 "끌고 있다"가 아니라 **"누르고 있다"**에 건다(줄의 `onPointerDownCapture`). 풀리는 건 window의
 *    pointerup·pointercancel·blur(창 밖에서 놓거나 포커스를 잃어도 잠긴 채 남지 않게).
 */
let armHeld = false;

function releaseArmedRow(): void {
  armHeld = false;
  if (typeof window === "undefined") return;
  window.removeEventListener("pointerup", releaseArmedRow);
  window.removeEventListener("pointercancel", releaseArmedRow);
  window.removeEventListener("blur", releaseArmedRow);
}

/** 줄을 누르는 순간 부른다 — 놓을 때까지 무장 줄이 바뀌지 않는다. */
export function holdArmedRow(): void {
  if (armHeld) return;
  armHeld = true;
  if (typeof window === "undefined") return;
  window.addEventListener("pointerup", releaseArmedRow);
  window.addEventListener("pointercancel", releaseArmedRow);
  window.addEventListener("blur", releaseArmedRow);
}

export function setArmedRow(key: string | null): void {
  if (armedRow === key) return;
  // 🔴 누르고 있거나 끌고 있는 동안은 바꾸지 않는다 — 바꾸면 끌던 줄이 언마운트돼 드롭 데이터가 사라진다(위 주석).
  if (armHeld || dragging) return;
  armedRow = key;
  for (const cb of armedSubscribers) cb();
}

/** 지금 무장된 줄의 키 — 렌더 밖(테스트·진단)용. 화면은 `useIsArmedRow`로 구독한다. */
export function getArmedRow(): string | null {
  return armedRow;
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

/**
 * **작은 모바일 화면인가** — 그런 화면에선 시간표 드래그를 아예 걸지 않는다
 * (원장 2026-09-12 *"작은 모바일화면에서는 시간표상의 드래그를 원천봉쇄시켜. 오히려 불편함."*).
 * 손가락보다 작은 칸을 집으려다 화면 스크롤이 끊기고, 놓을 칸이 화면 밖이라 어디로 가는지 보이지도 않는다.
 *
 * 🔴 `useIsDesktop`(min-width 1240 + any-pointer:fine)을 쓰면 안 된다 — 그 훅은 **창(iframe) 안에서 항상 false**라
 *    데스크톱에서 시간표를 창으로 열면 드래그가 통째로 죽는다. 여기선 **폭만** 본다.
 * 🔴 첫 렌더는 false(작지 않다)로 서버와 같게 — 첫 클라 렌더가 서버와 다르면 하이드레이션이 깨진다
 *    (이 리포엔 그것으로 화면 클릭이 통째로 죽은 전례가 둘: [[#75]]·[[#108]]). 폰에서도 첫 페인트 한 틱은
 *    드래그가 살아 있지만, 그사이 손가락이 칸을 5px 넘게 끌 수는 없다.
 * ⚠️ 회전·창 크기 변경을 따라가야 해서 한 번 재고 마는 `useTouchCapable`과 달리 `change`를 구독한다.
 */
const SMALL_SCREEN_QUERY = "(max-width: 640px)"; // 앱의 폰 기준(`max-sm:`)과 같은 경계
let smallMql: MediaQueryList | null = null;
function smallScreenMql(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  if (!smallMql) smallMql = window.matchMedia(SMALL_SCREEN_QUERY);
  return smallMql;
}

function subscribeSmallScreen(cb: () => void): () => void {
  const mq = smallScreenMql();
  if (!mq) return () => {};
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function useSmallScreen(): boolean {
  return useSyncExternalStore(
    subscribeSmallScreen,
    () => smallScreenMql()?.matches ?? false,
    () => false,
  );
}
