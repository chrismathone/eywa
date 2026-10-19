"use client";

import { useState } from "react";
import { SHEET_PALETTE, colorLabel } from "../palette";

/**
 * 색 판(구글 시트 70색) + 직접 고르기. `none`을 주면 맨 위에 '없음'(채우기 지우기 · 글자색 기본) 줄이 선다.
 * 직접 고르기는 [적용]을 눌러야 들어간다(색 고르는 창을 끄는 동안 칸이 수십 번 바뀌지 않게 — 되돌리기 이력도 한 칸).
 */
export function ColorPicker({
  value,
  none,
  onPick,
}: {
  value: string | undefined;
  none?: string;
  onPick: (hex: string | null) => void;
}) {
  const [custom, setCustom] = useState(value ?? "#000000");
  return (
    <div className="w-[260px] p-1">
      {none ? (
        <button type="button" className="hover:bg-bg-soft mb-1 w-full rounded-md px-2 py-1 text-left text-sm" onClick={() => onPick(null)}>
          {none}
        </button>
      ) : null}
      <div className="grid grid-cols-10 gap-1">
        {SHEET_PALETTE.flat().map((hex) => (
          <button
            key={hex}
            type="button"
            title={colorLabel(hex)}
            aria-label={colorLabel(hex)}
            onClick={() => onPick(hex)}
            className={`ring-line size-5 rounded-sm ring-1 transition hover:scale-110 ${value === hex ? "outline-primary outline-2 outline-offset-1" : ""}`}
            style={{ background: hex }}
          />
        ))}
      </div>
      <div className="border-line mt-2 flex items-center gap-2 border-t pt-2 text-sm">
        <span>직접 고르기</span>
        <input
          type="color"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          aria-label="색 직접 고르기"
          className="border-line h-7 w-10 cursor-pointer rounded border bg-transparent p-0"
        />
        <button type="button" className="hover:bg-bg-soft border-line ml-auto rounded-md border px-2 py-0.5" onClick={() => onPick(custom.toLowerCase())}>
          적용
        </button>
      </div>
    </div>
  );
}
