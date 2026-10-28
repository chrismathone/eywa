"use client";

import { LESSON_MEMO_MAX } from "../math-report-pilot";
import { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * '오늘의 수업' 메모 — 새 수학 보고서 행에서 그날 수업에 한 일을 짧게 적는다(원장 2026-10-28, 선택).
 * 예: "월말평가 오답 첨삭, 오답노트 작성". 자동작성이 '오늘의 수업' 항목에 그 사실을 녹여 쓴다(pilotAiDirective).
 * 표의 진도 칸 아래와 카드의 이해도 패널 아래가 같은 칸을 쓴다. 한 줄 입력(줄바꿈 없음).
 */
export function LessonMemoInput({
  value,
  onChange,
  disabled = false,
  ariaLabel,
  compact = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  /** 표 칸 안 — 높이를 줄인다. */
  compact?: boolean;
}) {
  const t = useSheetT();
  return (
    <input
      type="text"
      value={value}
      disabled={disabled}
      maxLength={LESSON_MEMO_MAX}
      aria-label={ariaLabel}
      placeholder={t("os.memo.ph")}
      onChange={(e) => onChange(e.target.value)}
      className={`border-line bg-card focus:border-primary w-full min-w-0 rounded-lg border px-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
        compact ? "mt-1 h-8" : "mt-2 h-(--control-h)"
      }`}
    />
  );
}
