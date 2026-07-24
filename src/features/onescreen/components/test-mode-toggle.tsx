"use client";

import type { TestScoreMode } from "../types";

/**
 * 테스트 점수 표기 모드 토글(0148a) — 개수("개")/점수("점") 2-세그먼트. 카드·그리드 셀 공용(컴팩트).
 * 학원 설정 기본값 위에 강사가 이 셀만 오버라이드하며, 값은 세션에 저장돼 다음 보고서로 승계된다(roster).
 */
export function TestModeToggle({
  mode,
  onMode,
  size = "sm",
}: {
  mode: TestScoreMode;
  onMode: (m: TestScoreMode) => void;
  size?: "sm" | "xs";
}) {
  const pad = size === "xs" ? "px-1 text-[9px] leading-4" : "px-1.5 py-0.5 text-[10px]";
  return (
    <span
      className="border-line inline-flex shrink-0 overflow-hidden rounded-sm border"
      role="group"
      aria-label="점수 표기 모드(개수/점수)"
    >
      {(["count", "score"] as const).map((m) => {
        const on = mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onMode(m)}
            aria-pressed={on}
            title={m === "score" ? "점수 표기(예: 95점)" : "개수 표기(예: 20문제 중 18개)"}
            className={`font-bold transition ${pad} ${
              on ? "bg-primary text-primary-foreground" : "text-text-faint hover:bg-bg-soft hover:text-foreground"
            }`}
          >
            {m === "score" ? "점" : "개"}
          </button>
        );
      })}
    </span>
  );
}
