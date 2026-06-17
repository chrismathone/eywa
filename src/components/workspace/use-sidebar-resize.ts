"use client";

import { useRef, useState } from "react";
import { usePrefs } from "./use-prefs";

/**
 * 사이드바 오른쪽 경계선 드래그로 너비를 조절하는 훅.
 * - 끌면 너비가 커서를 따라옴(라이브, 영속 쓰기는 drop에서 1회).
 * - THRESHOLD 미만으로 줄이면 접힘(아이콘 레일 52px)으로 스냅, 이상이면 펼침(MIN~MAX로 클램프).
 * - 더블클릭=빠른 토글, ←/→ 키=너비 조절/접고펴기(접근성). pointer capture로 영역 밖 드래그도 추적.
 * 반환: 현재(라이브 포함) expanded/width + dragging + 핸들 div에 스프레드할 handleProps.
 */
export const SIDEBAR_COLLAPSED_W = 52; // 접힘 레일 너비(아이콘만)
const THRESHOLD = 120; // 이 너비 미만으로 끌면 접힘으로 스냅
const MIN_EXPANDED = 150; // 펼침 최소 너비
const MAX_EXPANDED = 360; // 펼침 최대 너비
const KEY_STEP = 24; // 화살표 키 1칸

type Resolved = { expanded: boolean; width: number };

function resolve(raw: number): Resolved {
  if (raw < THRESHOLD) return { expanded: false, width: SIDEBAR_COLLAPSED_W };
  return { expanded: true, width: Math.min(MAX_EXPANDED, Math.max(MIN_EXPANDED, Math.round(raw))) };
}

export function useSidebarResize() {
  const expanded = usePrefs((s) => s.sidebarExpanded);
  const storedWidth = usePrefs((s) => s.sidebarWidth);
  const setSidebar = usePrefs((s) => s.setSidebar);
  const toggleSidebar = usePrefs((s) => s.toggleSidebar);

  const [live, setLive] = useState<Resolved | null>(null);
  const leftRef = useRef(0); // 드래그 시작 시 사이드바 좌측 x (커서 → 너비 변환 기준)

  const dragging = live !== null;
  const curExpanded = live ? live.expanded : expanded;
  const curWidth = live ? live.width : expanded ? storedWidth : SIDEBAR_COLLAPSED_W;

  function commit(width: number) {
    if (!expanded) return setSidebar(true, Math.max(MIN_EXPANDED, width));
    setSidebar(true, Math.min(MAX_EXPANDED, Math.max(MIN_EXPANDED, width)));
  }

  const handleProps = {
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      if (e.button !== 0) return;
      const aside = e.currentTarget.parentElement;
      leftRef.current = aside ? aside.getBoundingClientRect().left : 0;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
      setLive(resolve(e.clientX - leftRef.current));
    },
    onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      if (live) setSidebar(live.expanded, live.expanded ? live.width : undefined);
      setLive(null);
    },
    onDoubleClick() {
      setLive(null);
      toggleSidebar();
    },
    onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (!expanded) return;
        const w = storedWidth - KEY_STEP;
        if (w < THRESHOLD) setSidebar(false);
        else commit(w);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!expanded) setSidebar(true, MIN_EXPANDED);
        else commit(storedWidth + KEY_STEP);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleSidebar();
      }
    },
  };

  return { expanded: curExpanded, width: curWidth, dragging, handleProps };
}
