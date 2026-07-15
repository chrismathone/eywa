"use client";

import { useSyncExternalStore } from "react";
import {
  isTopFrame,
  notifyPermission,
  requestNotifyPermission,
  type NotifyPermission,
} from "./desktop-notify";

/**
 * 컴퓨터 알림 권한 / 안내 배너 노출 여부 — **브라우저가 들고 있는 외부 상태**라 useSyncExternalStore로 읽는다.
 * (effect에서 setState로 읽으면 `react-hooks/set-state-in-effect` 위반 + 캐스케이드 렌더 — gotcha #25.
 *  lazy useState 초기화도 금지 — SSR엔 Notification/localStorage가 없어 하이드레이션이 깨진다 — gotcha #75.)
 * 패턴은 use-in-frame.ts / use-is-desktop.ts와 동일: SSR 스냅샷 → 하이드레이션 후 실제값 확정.
 *
 * 값이 바뀌는 시점은 **우리가 권한을 요청했을 때 / 배너를 닫았을 때**뿐이라, 그때만 emit한다.
 */

const DISMISS_KEY = "eywa-notify-banner-dismissed";

let listeners: Array<() => void> = [];

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

// ── 권한 ──────────────────────────────────────────────────────────────────
const permSnapshot = (): NotifyPermission => notifyPermission(); // 문자열 primitive → Object.is 안정
const permServerSnapshot = (): NotifyPermission => "default"; // SSR: 하이드레이션 후 실제값으로 확정

/** 현재 컴퓨터 알림 권한. */
export function useNotifyPermission(): NotifyPermission {
  return useSyncExternalStore(subscribe, permSnapshot, permServerSnapshot);
}

/**
 * 권한 요청 + 스토어 갱신 — **반드시 클릭(사용자 제스처) 안에서** 호출(브라우저 정책).
 * 결과가 나오면 emit → 벨 버튼·중앙 팝업 안내·배너가 한꺼번에 최신 상태로 바뀐다.
 */
export async function enableDesktopNotify(): Promise<NotifyPermission> {
  const p = await requestNotifyPermission();
  emit();
  return p;
}

// ── 선제 안내 배너 ────────────────────────────────────────────────────────
// 저장소가 차단(사생활 모드 등)돼도 '나중에'가 먹히도록 메모리 폴백을 둔다(이 탭 세션 한정).
let dismissedMemo = false;

function bannerDismissed(): boolean {
  if (dismissedMemo) return true;
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** 배너를 띄울 상황인가 — 최상위 프레임 + 권한 미설정(default) + 아직 안 닫음. 그 외엔 안내할 게 없다. */
const bannerSnapshot = (): boolean => {
  if (typeof window === "undefined") return false;
  if (!isTopFrame()) return false; // iframe 중복 노출 방어
  if (notifyPermission() !== "default") return false; // 이미 허용/차단/미지원 → 안내 불필요
  return !bannerDismissed();
};
const bannerServerSnapshot = (): boolean => false; // SSR: 숨김 → 하이드레이션 후 필요하면 표시

export function useNotifyBannerVisible(): boolean {
  return useSyncExternalStore(subscribe, bannerSnapshot, bannerServerSnapshot);
}

/** 배너 '나중에' — localStorage에 기억(벨 드롭다운·중앙 팝업에 켜기 버튼이 계속 남아 있으므로 안전). */
export function dismissNotifyBanner() {
  dismissedMemo = true; // 저장 실패해도 즉시 닫히게
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* 저장 실패 → 이 탭 세션에만 반영 */
  }
  emit();
}
