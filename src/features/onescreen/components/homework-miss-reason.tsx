"use client";

import { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * 숙제 미제출 사유 — 수학 보고서 시범(테스트 학생 한정) 행에서 숙제 완성도가 미제출·0%일 때만 그린다(원장 2026-10-23
 * *"숙제완성도(미제출일경우 사유작성)"*). 적은 말은 보고서 '숙제 완성도' 항목에 그대로 들어가고, 비어 있으면 발송이 막힌다
 * (발송 게이트 `hwreason`, math-report-pilot-sections.ts `needsHomeworkMissReason`).
 */
export function HomeworkMissReasonInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (reason: string) => void;
}) {
  const t = useSheetT();
  const empty = value.trim() === "";
  return (
    <label className="mt-1.5 flex flex-col gap-1">
      <span className={`text-xs font-bold ${empty ? "text-danger" : "text-text-faint"}`}>{t("os.card.hwMiss.label")}</span>
      <input
        type="text"
        disabled={disabled}
        value={value}
        maxLength={200}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("os.card.hwMiss.ph")}
        aria-label={t("os.card.hwMiss.label")}
        className={`${empty ? "border-danger/50" : "border-line"} focus:border-primary bg-background h-8 rounded-lg border px-2 text-sm outline-none disabled:opacity-50`}
      />
    </label>
  );
}
