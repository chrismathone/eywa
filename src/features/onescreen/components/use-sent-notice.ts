"use client";

import { useSyncExternalStore } from "react";

// 사용자 요청: 이 설명의 다시 보지 않기는 계정 설정과 별개로 브라우저에만 저장한다.
export const SENT_NOTICE_KEY = "eywa:onescreen:sent-notice-hidden:v1";
const EVENT = "eywa:sent-notice-change";
let memoryFallback: boolean | undefined;

function subscribe(update: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SENT_NOTICE_KEY || event.key === null) {
      memoryFallback = undefined;
      update();
    }
  };
  window.addEventListener(EVENT, update);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, update);
    window.removeEventListener("storage", onStorage);
  };
}

function getHidden() {
  if (memoryFallback !== undefined) return memoryFallback;
  try { return window.localStorage.getItem(SENT_NOTICE_KEY) === "1"; }
  catch { return false; }
}

export function setSentNoticeHidden(hidden: boolean) {
  try {
    if (hidden) window.localStorage.setItem(SENT_NOTICE_KEY, "1");
    else window.localStorage.removeItem(SENT_NOTICE_KEY);
    memoryFallback = undefined;
  } catch {
    // 저장소가 막혀도 현재 창에서는 숨기기·복구가 동작한다.
    memoryFallback = hidden;
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useSentNoticeHidden() {
  // 서버는 이 브라우저의 선택을 모른다. 숨긴 배너가 새로고침 때 잠깐 나타나지 않게 한다.
  return useSyncExternalStore(subscribe, getHidden, () => true);
}
