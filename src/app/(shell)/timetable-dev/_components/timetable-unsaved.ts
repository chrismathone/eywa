"use client";

import { useEffect } from "react";

/**
 * 시간표 화면의 **미저장 이탈 가드** — '그룹 설정'(배치 편집)에서 아직 반영하지 않은 배치가 있는데
 * 주·과목·구분·뷰를 바꾸면 그대로 사라지던 것을 막는다(원장 2026-08-06 "편집중에 주 과목 뷰
 * 바꿀때도 경고 띄워줘").
 *
 * 왜 컨텍스트가 아니라 **모듈 스코프 플래그**인가: 읽는 쪽이 [ParamLink](src/app/(shell)/timetable/_components/param-link.tsx)
 * 인데, 툴바 링크는 편집 보드의 **형제**(같은 서버 컴포넌트가 나란히 렌더)라 Provider로 감싸려면
 * 페이지 트리를 통째로 client로 올려야 한다. 플래그는 창(iframe)마다 별개 문서라 서로 안 섞인다.
 *
 * 함께 막는 두 경로:
 * · 창 닫기(X)·Esc → 부모(workspace-canvas)에게 `eywa-window-dirty`를 보낸다
 *   ([use-unsaved-guard](src/components/workspace/use-unsaved-guard.ts)와 **같은 브리지**를 쓴다 —
 *   폼이 아니라 직렬화로 dirty를 못 재는 화면이라 훅은 못 쓰지만 프로토콜은 공유한다).
 * · 새로고침·탭 닫기 → `beforeunload`.
 */
let dirty = false;

function publishToParent(next: boolean) {
  if (typeof window === "undefined" || window.parent === window) return; // 창(iframe) 안에서만
  try {
    window.parent.postMessage({ type: "eywa-window-dirty", dirty: next }, window.location.origin);
  } catch {
    /* cross-origin 등 — 무시 */
  }
}

/** 편집 보드가 자기 dirty 상태를 여기 걸어 둔다. 언마운트 시 반드시 해제(stale 잠금 방지). */
export function useTimetableUnsavedGuard(isDirty: boolean) {
  useEffect(() => {
    dirty = isDirty;
    publishToParent(isDirty);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      if (dirty) {
        dirty = false;
        publishToParent(false);
      }
    };
  }, [isDirty]);
}

/** 편집을 스스로 끝낼 때(저장/나가기) — 자기 네비에 자기 경고가 뜨지 않게 먼저 푼다. */
export function clearTimetableUnsaved() {
  if (!dirty) return;
  dirty = false;
  publishToParent(false);
}

/**
 * 시간표 파라미터 네비 직전 확인 — 이동해도 되면 true.
 * ⚠️ 확인 문구는 **무엇을 잃는지**를 말한다("변경사항"이 아니라 "옮긴 배치"). 사람이 무엇을 버리는지
 * 알아야 판단할 수 있다.
 */
export function confirmTimetableNav(): boolean {
  if (!dirty) return true;
  const ok = window.confirm(
    "옮긴 배치를 아직 반영하지 않았습니다.\n이대로 이동하면 지금까지 옮긴 내용이 사라집니다. 이동할까요?",
  );
  if (ok) clearTimetableUnsaved();
  return ok;
}
