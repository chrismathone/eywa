"use client";

import { handleGridNavKey } from "./grid-nav";
import { TestMaxInput } from "./test-max-input";
import { TestModeToggle } from "./test-mode-toggle";
import type { TestScoreMode } from "../types";

function clamp(n: number, max: number) {
  return Math.max(0, Math.min(max, n));
}

/** 점수 셀 — 맞은 개수/점수 입력. count 모드=값+/문항수, score 모드="값 점"(만점 100 고정). allowMax면 문항수 편집.
 *  onMode를 주면 [개|점] 컴팩트 토글 노출(0148a). nav를 주면 Enter/↑↓로 같은 열 위·아래 행 이동(3-1). */
export function ScoreInput({
  value,
  max,
  onChange,
  label,
  allowMax,
  onMax,
  mode = "count",
  onMode,
  nav,
}: {
  value: number | null;
  max: number;
  onChange: (v: number | null) => void;
  label: string;
  allowMax?: boolean;
  onMax?: (v: number) => void;
  mode?: TestScoreMode;
  onMode?: (m: TestScoreMode) => void;
  nav?: { col: string; row: number };
}) {
  const scoreMode = mode === "score";
  return (
    <div className="flex items-center justify-center gap-0.5">
      <input
        inputMode="numeric"
        value={value == null ? "" : String(value)}
        aria-label={label}
        data-nav-col={nav?.col}
        data-nav-row={nav?.row}
        onKeyDown={nav ? handleGridNavKey : undefined}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          onChange(raw === "" ? null : clamp(parseInt(raw, 10) || 0, max));
        }}
        className="border-line focus:border-primary tabular h-8 w-10 rounded-sm border bg-background px-1 text-center text-[13px] font-bold outline-none"
      />
      {scoreMode ? (
        <span className="text-text-faint text-[10px]">점</span>
      ) : (
        <>
          <span className="text-text-faint tabular text-[11px]">/</span>
          {allowMax && onMax ? (
            // 빈칸 편집 허용(분모를 지우면 옛 값으로 스냅백하던 버그, 2026-07-24). onMax는 유효값만 받는다.
            <TestMaxInput
              max={max}
              onCommit={onMax}
              ariaLabel={`${label} 문항수`}
              className="border-line focus:border-primary tabular h-8 w-8 rounded-sm border bg-background px-0.5 text-center text-[11px] outline-none"
            />
          ) : (
            <span className="text-text-faint tabular text-[11px]">{max}</span>
          )}
        </>
      )}
      {onMode ? <TestModeToggle mode={mode} onMode={onMode} size="xs" /> : null}
    </div>
  );
}
