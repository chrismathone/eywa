"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * **검색은 화면 머리(PageHeader) 오른쪽 동작 줄 맨 앞에 선다**(원장 2026-10-19 — 직원관리 캡처에서 툴바 끝 '검색'을
 * 머리 '연차 관리' 왼쪽으로 화살표, *"에이와 내 검색 창 위치이동"* → 범위 "앱 전체").
 *
 * 검색 토글은 화면마다 툴바·클라 컨텍스트(출석부·시간표 검색 상태) 깊숙이 있어서, 25곳을 머리로 끌어올리면 상태를
 * 화면마다 다시 배선해야 한다 → 그 자리에 둔 채 **포털로 머리 자리에 그린다**(React 컨텍스트·상태는 그대로 따라간다).
 * 자리 = [`PageHeader`](./page-header.tsx)의 `data-page-header-search`.
 *
 * ⚠️ 머리가 없거나 **숨겨진** 화면(창·모바일에서 `compact-chrome:hidden`으로 머리를 접는 시간표 등)에선 원래 자리에
 *    그대로 그린다 — 안 그러면 검색이 화면에서 사라진다. 창 크기로 머리가 접히고 펴지므로 resize마다 다시 본다.
 * ⚠️ 서버 렌더·하이드레이션 첫 그림은 원래 자리다(서버엔 DOM이 없다) — 그 뒤 한 번 머리로 옮겨 간다.
 */
const SLOT = "[data-page-header-search]";

function findSlot(): Element | null {
  const slot = document.querySelector(SLOT);
  const header = slot?.closest("[data-page-header]");
  if (!slot || !header) return null;
  // 머리가 화면에 실제로 그려져 있을 때만(조상 display:none이면 rect가 0개).
  return header.getClientRects().length > 0 ? slot : null;
}

function subscribe(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

export function HeaderSearchSlot({ children }: { children: ReactNode }) {
  const slot = useSyncExternalStore(subscribe, findSlot, () => null);
  return slot ? createPortal(children, slot) : <>{children}</>;
}
