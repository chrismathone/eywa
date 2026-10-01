"use client";

import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import e from "./editor.module.css";

/**
 * 캔버스 = 놓을 곳 'canvas'. 🔴 `useDroppable`은 **DndContext 안쪽 자식**에서 불러야 등록된다 — DndContext를 그리는 컴포넌트에서
 * 부르면 컨텍스트 밖이라 조용히 안 잡힌다(2026-10-01 실측: 충돌 후보에 drawer·trash만 있었다).
 */
export function CanvasDrop({ over, children, onBackground }: { over: boolean; children: ReactNode; onBackground: () => void }) {
  const { setNodeRef } = useDroppable({ id: "canvas" });
  return (
    <div
      ref={setNodeRef}
      className={e.canvasWrap}
      data-over={over || undefined}
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onBackground();
      }}
    >
      {children}
    </div>
  );
}

export function Trash({ over, blocked }: { over: boolean; blocked: boolean }) {
  const { setNodeRef } = useDroppable({ id: "trash" });
  return (
    <div ref={setNodeRef} className={e.trash} data-over={(over && !blocked) || undefined} role="status">
      {blocked ? "마지막 카드는 뺄 수 없습니다" : over ? "놓으면 뺍니다" : "여기로 끌어 놓으면 뺍니다"}
    </div>
  );
}


export const ACCESSIBILITY = {
  screenReaderInstructions: { draggable: "마우스로 끌거나 길게 눌러 옮깁니다. 키보드는 화살표로 순서, Shift와 화살표로 크기, Delete로 뺍니다." },
  announcements: {
    onDragStart: () => "카드를 들었습니다.",
    onDragOver: () => undefined,
    onDragEnd: () => "카드를 놓았습니다.",
    onDragCancel: () => "옮기기를 취소했습니다.",
  },
};
