"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SheetActions } from "./use-sheet-actions";

/**
 * 우클릭 메뉴 — 엑셀처럼 그 자리에서 행·열 넣기/지우기·병합·지우기. 복사·잘라내기는 브라우저 복사 이벤트를 태워
 * 단축키와 같은 길(use-sheet-keys)로 간다. 붙여넣기는 브라우저가 단축키(Ctrl+V)로만 허락한다.
 * 화면 밖으로 안 나가게 위치를 접고, 밖을 누르거나 Esc·스크롤이면 닫는다.
 */
export function SheetMenu({
  x,
  y,
  canEdit,
  actions,
  onClose,
}: {
  x: number;
  y: number;
  canEdit: boolean;
  actions: SheetActions;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      if (e instanceof PointerEvent && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - (canEdit ? 420 : 90));
  const item = (label: ReactNode, run: () => void, enabled = true) => (
    <button
      type="button"
      disabled={!enabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        run();
        onClose();
      }}
      className="hover:bg-bg-soft flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm whitespace-nowrap disabled:opacity-50"
    >
      {label}
    </button>
  );
  const copy = (cmd: "copy" | "cut") => () => {
    // 숨은 입력칸이 초점을 들고 있어 복사 이벤트가 판의 핸들러로 간다.
    document.execCommand(cmd);
  };
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="bg-card border-line shadow-card fixed z-[70] w-[210px] rounded-xl border p-1.5"
      style={{ left: Math.max(4, left), top: Math.max(4, top) }}
    >
      {item("복사 (Ctrl+C)", copy("copy"))}
      {canEdit ? (
        <>
          {item("잘라내기 (Ctrl+X)", copy("cut"))}
          <div className="text-text-dim px-2 py-1 text-xs">붙여넣기는 Ctrl+V</div>
          <div className="bg-line my-1 h-px" />
          {item("위에 행 넣기", () => actions.insertRows("above"))}
          {item("아래에 행 넣기", () => actions.insertRows("below"))}
          {item("행 지우기", actions.deleteRows)}
          {item("왼쪽에 열 넣기", () => actions.insertCols("left"))}
          {item("오른쪽에 열 넣기", () => actions.insertCols("right"))}
          {item("열 지우기", actions.deleteCols)}
          <div className="bg-line my-1 h-px" />
          {item("셀 병합", actions.merge)}
          {item("병합 해제", actions.unmerge)}
          {item("내용 지우기", actions.clearContents)}
          {item("서식 지우기", actions.clearFormats)}
        </>
      ) : null}
    </div>,
    document.body,
  );
}
