"use client";

import { useState } from "react";
import type { BorderLine } from "../doc";
import type { BorderMode } from "../ops";
import { SHEET_PALETTE, colorLabel } from "../palette";
import { ToolGroupLabel, ToolItem } from "./tool-popover";

/**
 * 테두리 — 선 모양·색을 먼저 고르고(판이 닫히지 않는다) 어디에 그을지 누르면 들어간다(엑셀 '테두리 그리기'와 같은 순서).
 */
const LINES: { label: string; line: Omit<BorderLine, "c"> }[] = [
  { label: "얇은 실선", line: { w: 1, s: "solid" } },
  { label: "중간 실선", line: { w: 2, s: "solid" } },
  { label: "굵은 실선", line: { w: 3, s: "solid" } },
  { label: "파선", line: { w: 1, s: "dashed" } },
  { label: "점선", line: { w: 1, s: "dotted" } },
  { label: "이중선", line: { w: 3, s: "double" } },
];

const MODES: { mode: BorderMode; label: string }[] = [
  { mode: "all", label: "모든 테두리" },
  { mode: "outer", label: "바깥 테두리" },
  { mode: "inner", label: "안쪽 테두리" },
  { mode: "horizontal", label: "안쪽 가로선" },
  { mode: "vertical", label: "안쪽 세로선" },
  { mode: "top", label: "위쪽" },
  { mode: "bottom", label: "아래쪽" },
  { mode: "left", label: "왼쪽" },
  { mode: "right", label: "오른쪽" },
  { mode: "none", label: "테두리 없음" },
];

/** 선 색은 자주 쓰는 두 줄(회색조 + 원색)만 — 판을 작게 둔다. */
const LINE_COLORS = [...SHEET_PALETTE[0]!, ...SHEET_PALETTE[1]!];

export function BorderPicker({ onPick }: { onPick: (mode: BorderMode, line: BorderLine) => void }) {
  const [lineIdx, setLineIdx] = useState(0);
  const [color, setColor] = useState("#000000");
  const base = LINES[lineIdx]!.line;
  const line: BorderLine = { w: base.w, s: base.s, c: color };
  return (
    <div className="flex w-[360px] gap-2">
      <div className="flex-1">
        <ToolGroupLabel>어디에</ToolGroupLabel>
        {MODES.map((m) => (
          <ToolItem key={m.mode} onPick={() => onPick(m.mode, line)}>
            {m.label}
          </ToolItem>
        ))}
      </div>
      <div className="border-line w-[150px] border-l pl-2">
        <ToolGroupLabel>선 모양</ToolGroupLabel>
        {LINES.map((l, i) => (
          <button
            key={l.label}
            type="button"
            onClick={() => setLineIdx(i)}
            className={`hover:bg-bg-soft flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${i === lineIdx ? "bg-primary-soft font-bold" : ""}`}
          >
            <svg width="28" height="8" aria-hidden className="shrink-0">
              <line
                x1="0"
                x2="28"
                y1="4"
                y2="4"
                stroke="currentColor"
                strokeWidth={l.line.s === "double" ? 1 : l.line.w}
                strokeDasharray={l.line.s === "dashed" ? "4 2" : l.line.s === "dotted" ? "1 2" : undefined}
              />
              {l.line.s === "double" ? <line x1="0" x2="28" y1="7" y2="7" stroke="currentColor" strokeWidth={1} /> : null}
            </svg>
            {l.label}
          </button>
        ))}
        <ToolGroupLabel>선 색</ToolGroupLabel>
        <div className="grid grid-cols-5 gap-1 px-1">
          {LINE_COLORS.map((hex) => (
            <button
              key={hex}
              type="button"
              title={colorLabel(hex)}
              aria-label={colorLabel(hex)}
              onClick={() => setColor(hex)}
              className={`ring-line size-5 rounded-sm ring-1 ${color === hex ? "outline-primary outline-2 outline-offset-1" : ""}`}
              style={{ background: hex }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
