"use client";

import { useSyncExternalStore } from "react";

/**
 * 셔틀 '오늘 등하원' 하원 줄의 **체크 표시**(사용자 2026-10-06 표시 · 2026-10-07 "체크 표시 여부로 지금 학생이 존재하는지") 저장소.
 *
 * 🔑 체크는 **DB에 저장하지 않는다** — 차에 타기 전 "이 아이가 지금 여기 있나"를 눈으로 세는 표시라 탑승·미탑승 기록과
 *    다른 축이다. 대신 탭 세션(sessionStorage)에 둔다: 줄(RideRowItem)과 회차 머리의 [출발](TripControl)이 **같은 값**을
 *    봐야 해서다(출발 전 하원 체크 확인). 회차를 접었다 펴거나 새로고침해도 같은 탭에선 남고, 다른 기기엔 안 보인다.
 * ⚠️ 저장소를 못 쓰는 창(사생활 보호 등)에서도 이 화면 안에서는 남도록 메모리에 같이 둔다(ride-row-item 초안과 같은 결).
 */
const memory = new Map<string, boolean>();
const EVENT = "shuttle-check";

const keyOf = (date: string, rowKey: string) => `shuttle-check:${date}:${rowKey}`;

export function isRowChecked(date: string, rowKey: string): boolean {
  const key = keyOf(date, rowKey);
  try {
    const raw = sessionStorage.getItem(key);
    if (raw !== null) return raw === "1";
  } catch {
    // 메모리 사본으로 버틴다.
  }
  return memory.get(key) ?? false;
}

export function setRowChecked(date: string, rowKey: string, checked: boolean) {
  const key = keyOf(date, rowKey);
  if (checked) memory.set(key, true);
  else memory.delete(key);
  try {
    if (checked) sessionStorage.setItem(key, "1");
    else sessionStorage.removeItem(key);
  } catch {
    // 메모리 사본으로 버틴다.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/** 줄 하나의 체크 — 서버 그림은 늘 '체크 없음'이고 브라우저에서 세션 값으로 갈아끼운다. */
export function useRowChecked(date: string, rowKey: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isRowChecked(date, rowKey),
    () => false,
  );
}
