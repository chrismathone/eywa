"use client";

import { useDraggable, useDroppable, type DraggableAttributes, type DraggableSyntheticListeners, type KeyboardCoordinateGetter } from "@dnd-kit/core";
import { GripVertical } from "@/components/icons/aywa-icon-compat";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { EyIcon, type AywaIconName } from "@/components/icons/aywa-icons";
import type { ReactNode } from "react";
import type { PlacementEdge } from "@/features/owner/navigation-placement";
import { useWriteLock } from "./write-lock-context";

export type NavigationDrag =
  | { kind: "group"; groupId: string; label: string; icon: AywaIconName }
  | { kind: "menu"; href: string; label: string; icon: AywaIconName; fromLibrary?: boolean };
export type NavigationDrop =
  | { kind: "group"; groupId: string; label: string }
  | { kind: "menu"; groupId: string; href: string; label: string }
  | { kind: "end"; groupId: string; label: string };
export type NavigationHover = { id: string; edge: PlacementEdge; target: NavigationDrop };

/** 키보드로도 실제 드롭 칸을 하나씩 오간다. 고정 탭·보관함은 목적지가 아니다. */
export const navigationKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const direction = event.code;
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(direction) || !context.collisionRect) return;
  event.preventDefault();
  const origin = context.over?.rect ?? context.collisionRect;
  const x = origin.left + origin.width / 2;
  const y = origin.top + origin.height / 2;
  const kind = context.active?.data.current?.kind;
  const candidates = context.droppableContainers.getEnabled().flatMap((container) => {
    const target = container.data.current as NavigationDrop | undefined;
    const rect = context.droppableRects.get(container.id);
    if (!target || !rect || container.id === context.over?.id || container.id === context.active?.id || (kind === "group" && target.kind !== "group")) return [];
    const dx = rect.left + rect.width / 2 - x;
    const dy = rect.top + rect.height / 2 - y;
    const forward = direction === "ArrowDown" ? dy > 1 : direction === "ArrowUp" ? dy < -1 : direction === "ArrowRight" ? dx > 1 : dx < -1;
    if (!forward) return [];
    const distance = direction === "ArrowUp" || direction === "ArrowDown" ? Math.abs(dy) + Math.abs(dx) * 3 : Math.abs(dx) + Math.abs(dy) * 3;
    return [{ rect, distance }];
  }).sort((a, b) => a.distance - b.distance);
  const rect = candidates[0]?.rect;
  if (!rect) return;
  return {
    x: currentCoordinates.x + rect.left + rect.width / 2 - (context.collisionRect.left + context.collisionRect.width / 2),
    y: currentCoordinates.y + rect.top + rect.height / 2 - (context.collisionRect.top + context.collisionRect.height / 2),
  };
};

function DragHandle({ label, attributes, listeners, activatorRef }: {
  label: string; attributes: DraggableAttributes; listeners: DraggableSyntheticListeners;
  activatorRef: (node: HTMLElement | null) => void;
}) {
  // 읽기 권한(쓰기 잠금)이면 끌기 손잡이를 그리지 않는다 — 옮겨 놓아도 저장할 수 없다(write-lock-context.tsx).
  if (useWriteLock().locked) return null;
  return <button type="button" ref={activatorRef} {...attributes} {...listeners} aria-label={`${label} 끌기`}
    title="끌어서 이동 · 스페이스로 집기, 방향키로 이동, Esc로 취소"
    className="text-text-faint hover:text-primary hover:bg-primary-soft flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:cursor-grabbing">
    <GripVertical className="size-4" />
  </button>;
}

/** 입력칸/체크박스는 정상 조작하고 손잡이에서만 집는다. drop 영역은 행 전체. */
export function NavigationDragRow({ id, drag, drop, hover, folderOver, className = "", children }: {
  id: string; drag: NavigationDrag; drop?: NavigationDrop; hover: NavigationHover | null;
  folderOver?: boolean; className?: string; children: ReactNode;
}) {
  const draggable = useDraggable({ id, data: drag });
  const droppable = useDroppable({ id, data: drop, disabled: !drop });
  const insertion = hover?.id === id && !folderOver ? hover.edge : null;
  return <li ref={(node) => { draggable.setNodeRef(node); droppable.setNodeRef(node); }}
    className={`relative ${className} ${draggable.isDragging ? "opacity-35" : ""} ${folderOver ? "bg-primary-soft ring-primary ring-2 ring-inset" : ""}`}
    data-drop-active={folderOver ? "folder" : insertion ?? undefined}>
    {insertion ? <span aria-hidden className={`bg-primary pointer-events-none absolute right-0 left-0 z-10 h-0.5 rounded-full ${insertion === "before" ? "-top-1" : "-bottom-1"}`} /> : null}
    <DragHandle label={`${drag.label}${drag.kind === "group" ? " 탭" : ""}`} attributes={draggable.attributes} listeners={draggable.listeners} activatorRef={draggable.setActivatorNodeRef} />
    {children}
  </li>;
}

export function MenuDropEnd({ groupId, label, empty, active, children }: {
  groupId: string; label: string; empty: boolean; active: boolean; children?: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `end:${groupId}`, data: { kind: "end", groupId, label } satisfies NavigationDrop });
  return <div ref={setNodeRef} role="region" aria-label={`${label} 메뉴 넣기`} data-drop-active={isOver && active ? "end" : undefined}
    className={`mt-3 flex min-h-16 items-center justify-center rounded-xl border-2 border-dashed px-4 py-4 text-center text-sm transition-colors ${isOver && active ? "border-primary bg-primary-soft text-primary" : "border-line text-text-faint"} ${empty ? "min-h-40" : ""}`}>
    {children ?? (isOver && active ? `${label}에 놓기` : empty ? "메뉴 보관함에서 이곳으로 끌어 놓으세요." : "여기에 놓으면 맨 아래에 추가됩니다.")}
  </div>;
}

/** 보관함의 메뉴 카드는 어디를 집어도 끌 수 있고, 클릭하면 열린 탭에 담긴다. */
export function LibraryMenu({ drag, location, present, onAdd }: {
  drag: Extract<NavigationDrag, { kind: "menu" }>; location: string; present: boolean; onAdd: () => void;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `library:${drag.href}`, data: { ...drag, fromLibrary: true } });
  return <button type="button" ref={setNodeRef} {...attributes} {...listeners} onClick={() => { if (!present) onAdd(); }}
    onPointerDown={(event) => {
      // 터치는 손잡이에서만 집는다. 카드 본문을 쓸면 보관함이 자연스럽게 스크롤된다.
      if (event.pointerType === "touch" && !(event.target as Element).closest("[data-menu-drag-grip]")) return;
      listeners?.onPointerDown?.(event);
    }}
    title="끌어서 탭에 담기 · 클릭하면 현재 탭에 담기"
    className={`hover:bg-primary-soft flex w-full cursor-grab items-center gap-2 rounded-lg border border-transparent px-2 py-2.5 text-left active:cursor-grabbing ${isDragging ? "opacity-35" : ""}`}>
    <span data-menu-drag-grip className="text-text-faint flex h-8 w-5 shrink-0 touch-none items-center justify-center"><GripVertical className="size-3.5" /></span>
    <MenuGlyph name={drag.icon} size={22} />
    <span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{drag.label}</span><span className="text-text-faint block text-xs">{location}</span></span>
    <span aria-hidden className={`shrink-0 text-xs ${present ? "text-primary" : "text-text-faint"}`}>{present ? <EyIcon name="check" size={14} /> : <EyIcon name="plus" size={14} />}</span>
  </button>;
}
