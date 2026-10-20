"use client";

import { useCallback, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { Range } from "../doc";
import { blockFromAywaHtml, blockToHtml, blockToTsv, copyBlock, parseTsv, pasteBlock, textBlock } from "../clipboard";
import { blockFromHtmlTable } from "../html-paste";
import { jumpPos } from "../nav";
import type { CellEditor } from "./use-cell-editor";
import type { SheetActions } from "./use-sheet-actions";
import type { SheetModel } from "./use-sheet-model";

/**
 * 키보드·복사·붙여넣기 — 숨은 입력칸(use-cell-editor) 하나에 건다. 단축키는 엑셀과 같게:
 * 방향키(+Shift 범위 · +Ctrl 글자 끝) · Enter/Tab 이동 · F2 편집 · Delete 지우기 · Ctrl+B/I/U/5 · Ctrl+Z/Y · Ctrl+A · Ctrl+S.
 * 🔴 조합(IME) 중인 키는 전부 흘려보낸다 — Enter가 조합 확정인데 칸 확정으로 먹으면 한글 끝 글자가 사라진다.
 */
const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

export function useSheetKeys(opts: {
  model: SheetModel;
  editor: CellEditor;
  actions: SheetActions;
  canEdit: boolean;
  flush: () => void;
}) {
  const { model, editor, actions, canEdit, flush } = opts;
  /** 복사한 범위(점선 테두리) — Esc나 다음 편집에서 지운다. */
  const [copied, setCopied] = useState<Range | null>(null);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const native = e.nativeEvent;
      if (native.isComposing || e.key === "Process") return;
      const mod = e.ctrlKey || e.metaKey;
      const editing = editor.editingRef.current;
      if (editing) {
        if (e.key === "Enter" && e.altKey) {
          e.preventDefault();
          const ta = e.currentTarget;
          ta.setRangeText("\n", ta.selectionStart, ta.selectionEnd, "end");
          return;
        }
        const arrow = ARROWS[e.key];
        const step: [number, number] | null =
          e.key === "Enter" ? [e.shiftKey ? -1 : 1, 0]
          : e.key === "Tab" ? [0, e.shiftKey ? -1 : 1]
          : arrow && editing.mode === "replace" && !mod ? arrow
          : null;
        if (step) {
          e.preventDefault();
          editor.commit(step[0], step[1]);
        } else if (e.key === "Escape") {
          e.preventDefault();
          editor.cancel();
        }
        return;
      }
      const arrow = ARROWS[e.key];
      if (arrow) {
        e.preventDefault();
        if (mod) {
          const s = model.selRef.current;
          const target = jumpPos(model.docRef.current, e.shiftKey ? s.focus : s.anchor, arrow[0], arrow[1]);
          editor.select(target, e.shiftKey);
        } else editor.move(arrow[0], arrow[1], e.shiftKey);
        return;
      }
      if (mod) {
        const k = e.key.toLowerCase();
        const run = (fn: () => void) => {
          e.preventDefault();
          fn();
        };
        if (k === "z") return run(() => (e.shiftKey ? model.redo() : model.undo()));
        if (k === "y") return run(model.redo);
        if (k === "a") return run(() => model.setSel({ anchor: { r: 0, c: 0 }, focus: { r: model.docRef.current.rows - 1, c: model.docRef.current.cols - 1 } }));
        if (k === "s") return run(flush);
        if (k === "home") return run(() => editor.select({ r: 0, c: 0 }, e.shiftKey));
        if (!canEdit) return;
        if (k === "b") return run(() => actions.toggle("b"));
        if (k === "i") return run(() => actions.toggle("i"));
        if (k === "u") return run(() => actions.toggle("u"));
        if (k === "5") return run(() => actions.toggle("st"));
        return; // Ctrl+C/X/V는 브라우저가 copy/cut/paste 이벤트로 넘긴다
      }
      switch (e.key) {
        case "Enter":
          e.preventDefault();
          return editor.move(e.shiftKey ? -1 : 1, 0, false);
        case "Tab":
          e.preventDefault();
          return editor.move(0, e.shiftKey ? -1 : 1, false);
        case "F2":
          e.preventDefault();
          return editor.startEdit("edit");
        case "Delete":
        case "Backspace":
          e.preventDefault();
          if (canEdit) actions.clearContents();
          return;
        case "Escape":
          setCopied(null);
          return;
        case "Home":
          e.preventDefault();
          return editor.select({ r: model.selRef.current.anchor.r, c: 0 }, e.shiftKey);
        case "PageDown":
        case "PageUp":
          e.preventDefault();
          return editor.move(e.key === "PageDown" ? 20 : -20, 0, e.shiftKey);
      }
      // 글자 키는 그대로 입력칸에 들어가고, input 이벤트가 편집을 연다(beginTyping).
    },
    [actions, canEdit, editor, flush, model],
  );

  const writeClipboard = (e: ClipboardEvent<HTMLTextAreaElement>, range: Range) => {
    const block = copyBlock(model.docRef.current, range);
    e.clipboardData.setData("text/plain", blockToTsv(block));
    e.clipboardData.setData("text/html", blockToHtml(block));
    setCopied(range);
  };

  const onCopy = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (editor.editingRef.current) return;
    e.preventDefault();
    writeClipboard(e, actions.current());
  };

  const onCut = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (editor.editingRef.current) return;
    e.preventDefault();
    const range = actions.current();
    writeClipboard(e, range);
    if (canEdit) actions.clearContents();
    setCopied(null);
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (editor.editingRef.current) return;
    e.preventDefault();
    if (!canEdit) return;
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    const own = html ? blockFromAywaHtml(html) : null;
    const outside = own ? null : html ? blockFromHtmlTable(html) : null;
    const styled = own ?? outside;
    const block = styled ?? (text ? textBlock(parseTsv(text)) : null);
    if (!block) return;
    const at = actions.current();
    let pasted: Range | null = null;
    const ok = model.apply((d) => {
      // 바깥(구글 시트·엑셀) 표의 병합은 테두리를 왼쪽 위 칸에만 싣고 온다 — 그때만 나눠 적는다(merge-borders.ts).
      const out = pasteBlock(d, { r: at.r0, c: at.c0 }, block, styled !== null, outside !== null);
      pasted = out.range;
      return out.doc;
    });
    const range = pasted as Range | null;
    if (ok && range) model.setSel({ anchor: { r: range.r0, c: range.c0 }, focus: { r: range.r1, c: range.c1 } });
    setCopied(null);
  };

  return { onKeyDown, onCopy, onCut, onPaste, copied, clearCopied: () => setCopied(null) };
}
