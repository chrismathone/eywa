"use client";

import { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * 점수 칸이 오늘 수학 채점 결과로 채워졌다는 작은 표시(2026-10-17 · 개발 중). 표시 여부는 `todaysMathMarked`가 정한다 —
 * 선생님이 칸을 고치면 사라진다. 저장 · 학부모 글에는 아무 영향이 없다(표시 전용).
 */
export function TodaysMathMark() {
  const t = useSheetT();
  return (
    <span className="text-primary mt-0.5 block text-xs font-semibold whitespace-nowrap" title={t("os.score.todaysMathTip")}>
      {t("os.score.todaysMath")}
    </span>
  );
}
