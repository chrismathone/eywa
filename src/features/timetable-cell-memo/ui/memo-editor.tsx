"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { HOVER_CARD_FRAME } from "@/components/hover-tip/card-style";
import { clampMemoSize, MEMO_BODY_MAX, type CellMemo } from "../rules";
import { resizeCellMemo } from "../server/actions";
import type { MemoTarget } from "./cell-dom";
import { ConflictNote, EditorFooter, ResizeHandles } from "./memo-editor-parts";
import { useBoxResize } from "./use-box-resize";
import { useCellMemoSaver, type MemoEditorCallbacks } from "./use-cell-memo-saver";

/**
 * 칸 메모 **편집 상자** — '메모 추가'·'메모 편집'·보기 상자 누르기로 열린다. 저장 단추가 없다(입력하는 대로 저장, `memo-saver.ts`).
 * 바깥을 누르거나 Esc = 마지막 입력까지 저장하고 닫는다(비웠으면 지운다). 저장이 막히면(충돌·오류) 닫지 않고 알린다.
 * 🔴 다른 사람이 먼저 고쳤으면 **최신 내용을 보여 주고** 내 글은 '내가 쓴 글로 덮어쓰기'로 되살린다(조용히 덮지 않는다).
 * 크기는 따로 끈다(원장 *"크기는 따로 움직이게"*) — 메모마다 저장, 정보 카드와 묶이지 않는다.
 * 포털 + fixed([[#128]]) — 시간표를 굴리면 칸을 따라 움직이고, 칸이 사라지면 저장하고 닫는다.
 */

type Props = MemoEditorCallbacks & {
  target: MemoTarget;
  memo: CellMemo | null;
  /** 이 칸의 지금 메모들(다른 화면 저장이 들어오면 갱신) — 고치던 게 없으면 최신으로 바꿔 보여 준다. */
  cellMemos: readonly CellMemo[];
  at: { left: number; top: number };
  subject: string;
  onResized: (id: string, size: { width: number; height: number }) => void;
  onClose: () => void;
};

export function MemoEditor(props: Props) {
  const { target, memo, cellMemos, subject } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const cb = useRef(props);
  const [at, setAt] = useState(props.at);
  const atRef = useRef(props.at);
  // 크기는 사람이 바꿨을 때만 함께 저장한다(안 바꿨으면 기본 크기 = 빈 값).
  const sizeRef = useRef<{ width: number; height: number } | null>(
    memo?.width != null && memo?.height != null ? { width: memo.width, height: memo.height } : null,
  );
  const { saver, currentId, status, conflict, empty, dismiss, overwrite, onInput, settled } = useCellMemoSaver({
    memo, target, subject, cellMemos, sizeRef, areaRef, cb,
  });

  const { size, start } = useBoxResize(
    clampMemoSize(memo?.width, memo?.height),
    () => atRef.current,
    (next) => {
      sizeRef.current = next;
      const { id } = saver().current();
      if (!id) return; // 새 메모 — 첫 저장에 함께 간다
      void resizeCellMemo({ id, ...next })
        .then((r) => (r.ok ? cb.current.onResized(id, next) : toast.error(r.error)))
        .catch(() => toast.error("크기를 저장하지 못했습니다"));
    },
  );

  const closing = useRef(false);
  const requestClose = async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      await saver().flush(true);
    } finally {
      closing.current = false;
    }
    if (settled()) cb.current.onClose();
  };
  const closeRef = useRef(requestClose);
  useEffect(() => {
    cb.current = props;
    closeRef.current = requestClose;
  });

  useEffect(() => {
    const area = areaRef.current;
    area?.focus();
    area?.setSelectionRange(area.value.length, area.value.length);
  }, []);

  // 바깥 누름 = 저장하고 닫기 · 표를 굴리면 칸을 따라간다(칸이 사라지면 닫는다).
  useEffect(() => {
    const td = target.td;
    const r0 = td.getBoundingClientRect();
    const off = { dx: atRef.current.left - r0.left, dy: atRef.current.top - r0.top };
    const inside = (t: EventTarget | null) => t instanceof Node && !!boxRef.current?.contains(t);
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) void closeRef.current();
    };
    let raf = 0;
    const follow = (e: Event) => {
      if (inside(e.target) || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!td.isConnected) return void closeRef.current();
        const r = td.getBoundingClientRect();
        atRef.current = { left: Math.round(r.left + off.dx), top: Math.round(r.top + off.dy) };
        setAt(atRef.current);
      });
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [target.td]);

  return createPortal(
    <div
      ref={boxRef}
      role="dialog"
      aria-label="칸 메모"
      className={`${HOVER_CARD_FRAME} fixed z-[10000] flex flex-col overflow-hidden`}
      style={{ left: at.left, top: at.top, width: size.width, height: size.height }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        void requestClose();
      }}
    >
      {conflict ? <ConflictNote conflict={conflict} onOverwrite={overwrite} onDismiss={dismiss} /> : null}
      <textarea
        ref={areaRef}
        defaultValue={memo?.body ?? ""}
        maxLength={MEMO_BODY_MAX}
        aria-label="메모 내용"
        className="text-foreground min-h-0 w-full flex-1 resize-none bg-transparent px-3 pt-2 pb-1 text-sm outline-none"
        onInput={(e) => onInput(e.currentTarget.value)}
      />
      <EditorFooter
        live={currentId ? cellMemos.find((m) => m.id === currentId) : undefined}
        status={status}
        empty={empty}
        saved={currentId != null}
        onRetry={() => void saver().flush()}
      />
      <ResizeHandles start={start} />
    </div>,
    document.body,
  );
}
