"use client";

import { useId, useState } from "react";
import { dotProps, isCustomColor, colorLabel, CUSTOM_COLOR_SEED, PRESET_SWATCHES } from "@/features/calendar/color";
import type { CalendarColor } from "@/features/calendar/types";

/**
 * 색 선택기 — **프리셋 + 직접 선택(색상환)**. 원장 2026-08-19: *"새 태그 이름 추가할 때 색상이
 * 고정인데, 내가 색상 선택해서 할 수 있는 그걸로 만들 수 있게."*
 *
 * 🔑 프리셋을 남긴 이유: 자주 쓰는 색은 한 번에 고르는 게 빠르고, 토큰 색이라 팔레트를 리스킨하면
 *    자동으로 따라온다. '직접 선택'은 그 밖의 색을 쓰고 싶을 때의 탈출구다(`<input type="color">`
 *    = OS 색상환). 저장 값은 hex 문자열이라 DB·조회 경로가 그대로다(0224a: color는 text).
 *
 * ⚠️ 점만 있으면 무슨 색인지 모른다 — **선택된 색 이름을 항상 글자로** 보여준다(모바일엔 title
 *    툴팁이 없는 것과 같다, design-conventions).
 */
export function ColorPicker({
  value,
  onChange,
  /** 스와치 크기 — 목록 행은 촘촘하게(sm), 등록 폼은 크게(md). */
  size = "md",
  label = "색",
}: {
  value: CalendarColor;
  onChange: (c: CalendarColor) => void;
  size?: "sm" | "md";
  label?: string;
}) {
  const inputId = useId();
  // 색상환을 열기 전까지의 시작점 — 이미 사용자 지정 색이면 그 색에서 이어 고른다.
  const [custom, setCustom] = useState(isCustomColor(value) ? value : CUSTOM_COLOR_SEED);
  const swatch = size === "sm" ? "size-5" : "size-6";
  const customActive = isCustomColor(value);

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="flex flex-wrap items-center gap-1.5">
        {PRESET_SWATCHES.map((p) => {
          const dot = dotProps(p.value);
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onChange(p.value)}
              title={p.label}
              aria-label={`${label} ${p.label}`}
              aria-pressed={value === p.value}
              className={`${swatch} rounded-full transition ${dot.className} ${
                value === p.value
                  ? "ring-primary/60 ring-2 ring-offset-2"
                  : "opacity-60 hover:opacity-100"
              }`}
            />
          );
        })}

        {/* 직접 선택 — 네이티브 색상환. 라벨을 클릭 표적으로 삼아 스와치와 같은 크기·모양으로 보인다. */}
        {/* ⚠️ input은 opacity-0이라 자체 포커스 링이 안 보인다 — 감싼 label이 focus-within으로
            프리셋 버튼과 같은 링을 그린다(키보드로 왔을 때 어디 있는지 보이게). */}
        <label
          htmlFor={inputId}
          title="직접 선택"
          className={`${swatch} focus-within:ring-primary/60 relative cursor-pointer overflow-hidden rounded-full transition focus-within:ring-2 focus-within:ring-offset-2 ${
            customActive ? "ring-primary/60 ring-2 ring-offset-2" : "opacity-70 hover:opacity-100"
          }`}
          // 무지개 = "여기서 아무 색이나" 라는 관용 표현. 고른 뒤에는 그 색으로 채워진다.
          style={{
            background: customActive
              ? value
              : "conic-gradient(#ef4444,#f59e0b,#22c55e,#3b82f6,#8b5cf6,#ef4444)",
          }}
        >
          <input
            id={inputId}
            type="color"
            value={customActive ? value : custom}
            onChange={(e) => {
              setCustom(e.target.value);
              onChange(e.target.value);
            }}
            aria-label={`${label} 직접 선택`}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </span>

      {/* 고른 색이 무엇인지 글자로 — 점만으로는 이름을 알 수 없다. */}
      <span className="text-text-dim text-[11px] whitespace-nowrap">
        {customActive ? <span className="num">{colorLabel(value)}</span> : colorLabel(value)}
        {customActive ? <span className="text-text-faint"> · 직접 선택</span> : null}
      </span>
    </div>
  );
}
