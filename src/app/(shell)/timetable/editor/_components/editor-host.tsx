"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef } from "react";
import { windowDirtyMessage } from "@/components/workspace/window-bridge";
import type { LabAppearance } from "@/features/timetable-lab/types";
import { EditorSkeleton } from "./editor-skeleton";

// 편집기는 무겁고(격자·끌기·창) 브라우저 API에 기대므로 서버에서 그리지 않고, 이 화면을 열 때만 내려받는다(B5).
const Editor = dynamic(() => import("./editor-impl").then((m) => m.EditorImpl), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

/** 창(iframe) 안이면 부모 작업면에 미저장 여부를 알린다 — 닫기(X)·Esc가 확인을 거친다. timetable-unsaved와 같은 브리지. */
function publishToParent(dirty: boolean) {
  if (typeof window === "undefined" || window.parent === window) return;
  try {
    window.parent.postMessage(windowDirtyMessage(dirty), window.location.origin);
  } catch {
    /* cross-origin 등 — 무시 */
  }
}

/** 이 클릭이 지금 화면을 떠나는 링크인가 — 새 탭·내려받기·같은 화면 안 이동은 아니다. */
function leavingLink(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self") || link.hasAttribute("download")) return false;
  const to = new URL(link.href, window.location.href);
  return to.origin === window.location.origin && to.pathname !== window.location.pathname;
}

/**
 * 시간표 편집기를 앱 화면에 올린다.
 * 새로고침·탭 닫기 경고(beforeunload)는 편집기가 스스로 걸고, 여기서는 나머지 두 길을 잇는다:
 * ① 창(iframe)의 닫기 확인 ② 창 없이 열렸을 때(단일 화면·모바일) 다른 메뉴로 넘어가는 링크 — 그대로 두면 연습본이 말없이 사라진다.
 */
export function TimetableEditorHost({ appearance }: { appearance: LabAppearance }) {
  const dirty = useRef(false);
  const onDirtyChange = useCallback((next: boolean) => {
    if (next === dirty.current) return; // 바뀔 때만 보낸다
    dirty.current = next;
    publishToParent(next);
  }, []);
  useEffect(() => {
    const guard = (event: MouseEvent) => {
      if (!dirty.current || !leavingLink(event)) return;
      if (window.confirm("저장하지 않은 연습본이 있습니다.\n이 화면을 떠나면 지금까지 고친 내용이 사라집니다. 떠날까요?")) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("click", guard, true);
    return () => {
      document.removeEventListener("click", guard, true);
      // 화면을 떠날 때(창 안 뒤로 가기 등) 반드시 푼다 — 안 풀면 부모가 다음 화면까지 '미저장'으로 잠근다.
      if (dirty.current) {
        dirty.current = false;
        publishToParent(false);
      }
    };
  }, []);
  return <Editor appearance={appearance} onDirtyChange={onDirtyChange} />;
}
