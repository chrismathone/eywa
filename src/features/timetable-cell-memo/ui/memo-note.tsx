"use client";

import type { Ref } from "react";
import { createPortal } from "react-dom";
import { HOVER_CARD_SHELL } from "@/components/hover-tip/card-style";
import { formatMemoStamp, hmOf, type CellMemo } from "../rules";

/**
 * 칸 메모 **보기 상자** — 칸에 마우스를 올리면 뜬다(수업 칸은 정보 카드 오른쪽 2열, 빈 칸은 이것만).
 * 마지막 줄 = `yy.mm.dd hh:mm 이름`(원장 지정 형식 · 저장값에서 그린다). 크기는 메모마다 저장된 크기.
 * 고칠 수 있는 사람이 누르면 그 자리에서 편집 상자로 바뀐다(구글 시트 메모처럼).
 * 행 간격을 넓혀 한 칸에 메모가 둘 이상 들어오면 전부 보인다(각자 시각을 머리에).
 */
export function MemoNote({
  memos,
  size,
  canEdit,
  onActivate,
}: {
  memos: readonly CellMemo[];
  size: { width: number; height: number };
  canEdit: boolean;
  onActivate?: (rect: DOMRect) => void;
}) {
  const activate = canEdit && onActivate ? onActivate : null;
  return (
    <div
      role="note"
      aria-label="칸 메모"
      className={`${HOVER_CARD_SHELL} shrink-0 overflow-y-auto ${activate ? "cursor-text" : ""}`}
      style={{ width: size.width, height: size.height }}
      onClick={activate ? (e) => activate(e.currentTarget.getBoundingClientRect()) : undefined}
    >
      {memos.map((m, i) => (
        <div key={m.id} className={i > 0 ? "border-line mt-2 border-t pt-2" : undefined}>
          {memos.length > 1 ? <p className="num text-xs font-bold">{hmOf(m.startMin)}</p> : null}
          <p className="text-foreground text-sm break-words whitespace-pre-wrap">{m.body}</p>
          <p className="border-line num mt-1.5 border-t pt-1 text-xs">{formatMemoStamp(m.updatedAt, m.updatedByName)}</p>
        </div>
      ))}
    </div>
  );
}

/** 빈 칸(수업 없는 칸) 메모 보기 상자 — 칸 옆에 뜬다(포털 + fixed · 마우스를 칸에서 상자로 옮겨도 유지). */
export function FloatingNote({
  boxRef,
  at,
  onEnter,
  onLeave,
  ...note
}: Parameters<typeof MemoNote>[0] & {
  boxRef: Ref<HTMLDivElement>;
  at: { left: number; top: number };
  onEnter: () => void;
  onLeave: () => void;
}) {
  return createPortal(
    <div ref={boxRef} className="fixed z-[9999]" style={at} onPointerEnter={onEnter} onPointerLeave={onLeave}>
      <MemoNote {...note} />
    </div>,
    document.body,
  );
}
