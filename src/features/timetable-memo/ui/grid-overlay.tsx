"use client";

import type { CSSProperties, RefObject, TextareaHTMLAttributes } from "react";
import { SHEET_LIMITS, type CellStyle, type Range } from "../doc";
import { rectOf, type Layout } from "../geometry";
import { fontStyle } from "../style-css";

/**
 * 선택 층 — 고른 범위는 옅게 칠하고(지금 칸은 비워 둔다 — 엑셀과 같다), 지금 칸은 굵은 테두리.
 * 복사한 범위는 점선. 편집 칸(textarea)은 늘 지금 칸 자리에 있다(안 보일 때도 — 한글 조합 창이 그 자리에 뜬다).
 */
export function SelectionLayer({ layout, range, active, copied }: { layout: Layout; range: Range; active: Range; copied: Range | null }) {
  const r = rectOf(layout, range);
  const a = rectOf(layout, active);
  const c = copied ? rectOf(layout, copied) : null;
  const hole = `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z M${a.x} ${a.y}h${a.w}v${a.h}h${-a.w}Z`;
  return (
    <svg className="pointer-events-none absolute top-0 left-0 z-10 overflow-visible" width={layout.width} height={layout.height} aria-hidden>
      <path d={hole} fillRule="evenodd" className="fill-primary/10" />
      <rect x={r.x - 0.5} y={r.y - 0.5} width={r.w} height={r.h} fill="none" className="stroke-primary" strokeWidth={1} />
      <rect x={a.x - 1} y={a.y - 1} width={a.w} height={a.h} fill="none" className="stroke-primary" strokeWidth={2} />
      {c ? (
        <rect x={c.x - 1} y={c.y - 1} width={c.w} height={c.h} fill="none" className="stroke-primary" strokeWidth={2} strokeDasharray="5 3" />
      ) : null}
    </svg>
  );
}

export function CellEditorBox({
  taRef,
  layout,
  active,
  style,
  editing,
  readOnly,
  handlers,
}: {
  taRef: RefObject<HTMLTextAreaElement | null>;
  layout: Layout;
  active: Range;
  style: CellStyle | undefined;
  editing: boolean;
  readOnly: boolean;
  handlers: Pick<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    "onKeyDown" | "onInput" | "onCompositionStart" | "onCopy" | "onCut" | "onPaste" | "onBlur"
  >;
}) {
  const a = rectOf(layout, active);
  const box: CSSProperties = editing
    ? {
        left: a.x - 1,
        top: a.y - 1,
        minWidth: a.w + 1,
        minHeight: a.h + 1,
        maxWidth: 640,
        ...fontStyle(style),
        textAlign: style?.ha ?? "left",
        background: style?.bg ?? "#ffffff",
        fieldSizing: "content",
      } as CSSProperties
    : { left: a.x, top: a.y, width: Math.max(1, a.w - 2), height: Math.max(1, a.h - 2), opacity: 0, caretColor: "transparent" };
  return (
    <textarea
      ref={taRef}
      aria-label="칸 입력"
      spellCheck={false}
      autoComplete="off"
      readOnly={readOnly}
      maxLength={SHEET_LIMITS.text}
      rows={1}
      className={`absolute z-20 resize-none overflow-hidden px-[3px] py-[2px] leading-[1.15] whitespace-pre-wrap outline-none ${
        editing ? "ring-primary shadow-card ring-2" : "pointer-events-none"
      }`}
      style={box}
      {...handlers}
    />
  );
}
