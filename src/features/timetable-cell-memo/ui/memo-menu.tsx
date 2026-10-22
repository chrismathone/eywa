"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { HOVER_CARD_FRAME } from "@/components/hover-tip/card-style";

/**
 * 칸 우클릭 메뉴 — 엑셀 문구 그대로('메모 추가' / '메모 편집' · '메모 삭제'). 고칠 수 있는 사람에게만 뜬다
 * (보기만 되는 사람은 브라우저 기본 메뉴 — 레이어가 막지 않는다).
 * 포털 + fixed — 시간표 스크롤 상자에 잘리지 않는다([[#128]]). 바깥 누름 · Esc · 스크롤 · 창 이탈에 닫힌다.
 */

const W = 168;
const H = 96;

export function MemoMenu({
  x,
  y,
  hasMemo,
  onAdd,
  onEdit,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  hasMemo: boolean;
  onAdd: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (e: Event) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      e.preventDefault();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("wheel", outside, true);
    document.addEventListener("scroll", outside, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("wheel", outside, true);
      document.removeEventListener("scroll", outside, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(x, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - H - 8));
  const item = "hover:bg-bg-soft focus-visible:bg-bg-soft w-full rounded-md px-3 py-1.5 text-left text-sm outline-none";
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="칸 메모"
      className={`${HOVER_CARD_FRAME} fixed z-[10001] p-1`}
      style={{ left, top, width: W }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {hasMemo ? (
        <>
          <button type="button" role="menuitem" className={item} onClick={onEdit}>
            메모 편집
          </button>
          <button type="button" role="menuitem" className={`${item} text-danger`} onClick={onDelete}>
            메모 삭제
          </button>
        </>
      ) : (
        <button type="button" role="menuitem" className={item} onClick={onAdd}>
          메모 추가
        </button>
      )}
    </div>,
    document.body,
  );
}
