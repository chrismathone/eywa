"use client";

import { handleGridNavKey } from "./grid-nav";
import { NONE_LABEL } from "../none-marker";
import { parseHomeworkRate } from "../homework-rate";

/**
 * 과제 수행률 입력 — **숫자 한 칸 + `%`**(원장 2026-08-03: *"일일·확인처럼 두 칸으로. 숫자만 입력하면 자동 %처리."*).
 *
 * 🔴 왜 드롭다운이 아닌가: 선택지가 완료/일부 미흡/미제출 3단계였을 때 90% 해온 학생이 '일부 미흡'으로
 *    체크돼 학부모 그래프에 **50**으로 찍혔다(그 숫자를 보고 학부모가 학생을 혼냈다). 그렇다고 10% 눈금
 *    11개를 드롭다운에 넣으니 *"고르기 너무 힘들다"* — 정도를 아는 사람은 강사뿐이니 **그냥 치게** 한다.
 *
 * 모양은 옆 칸(일일·확인테스트 [`ScoreInput`](./score-input.tsx)) 점수 모드와 같다 — 숫자 칸 + 단위.
 * 저장값은 `"90%"` 문자열(퍼센트가 곧 값). `없음` = **지난 과제가 존재하지 않았음**(0%가 아니다 — 추세·그래프 제외).
 */
export function HomeworkRateInput({
  value,
  onChange,
  label,
  nav,
  size = "sm",
}: {
  /** 저장값 그대로("90%"·"없음"·""·옛 표기 "완료"). */
  value: string;
  onChange: (v: string) => void;
  label: string;
  nav?: { col: string; row: number };
  /** sm=표(촘촘) · lg=카드·일괄(이웃 입력칸과 같은 라운드). */
  size?: "sm" | "lg";
}) {
  const isNone = value.trim() === NONE_LABEL;
  // 옛 표기(완료·미제출)도 숫자로 읽어 그대로 보여 준다 — 빈칸으로 보이면 값이 사라진 줄 안다.
  const n = isNone ? null : parseHomeworkRate(value);
  const shown = n == null ? "" : String(n);
  const radius = size === "sm" ? "rounded-sm" : "rounded-lg";

  return (
    <div className="flex items-center gap-1">
      <input
        inputMode="numeric"
        value={shown}
        disabled={isNone}
        aria-label={label}
        placeholder="—"
        data-nav-col={nav?.col}
        data-nav-row={nav?.row}
        onKeyDown={nav ? handleGridNavKey : undefined}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          if (raw === "") return onChange("");
          onChange(`${Math.max(0, Math.min(100, parseInt(raw, 10) || 0))}%`);
        }}
        className={`border-line focus:border-primary tabular bg-card h-8 w-12 border px-1 text-center text-[13px] font-bold outline-none disabled:opacity-40 ${radius}`}
      />
      <span className="text-text-faint text-[11px]">%</span>
      {/* 과제가 **없던 날** — 미제출(0%)과 다르다. 다시 누르면 해제. */}
      <button
        type="button"
        onClick={() => onChange(isNone ? "" : NONE_LABEL)}
        aria-pressed={isNone}
        title="지난 과제가 없던 날 (미제출 아님)"
        className={`h-8 shrink-0 rounded-full border px-2 text-[11px] transition-colors ${
          isNone ? "border-primary bg-primary/10 text-primary font-bold" : "border-line text-text-faint"
        }`}
      >
        없음
      </button>
    </div>
  );
}
