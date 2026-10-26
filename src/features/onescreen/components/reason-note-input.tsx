"use client";

import { useSheetT } from "@/features/teacher-view/lang-context";
import type { SheetDictKey } from "@/features/teacher-view/i18n";

/**
 * 강사가 직접 적는 필수 글 칸 — '수업 태도 의견'(태도 하·중하, 3줄 이상) · '보강 사유'(결석 날짜를 예약에서 못 찾은 보강 줄)
 * (원장 2026-10-26). 숙제 미제출 사유(`HomeworkMissReasonInput`)와 같은 모양 · 같은 규약: 다 채우기 전엔 라벨이 빨갛고
 * 발송이 막힌다(send-gate · pilot-send-gate · 서버 pilotCheck). 적은 말은 보고서에 그대로 들어간다.
 */
export function ReasonNoteInput({
  value,
  done,
  disabled,
  multiline,
  labelKey,
  placeholderKey,
  onChange,
}: {
  value: string;
  /** 조건을 채웠나(태도 의견 = 3줄·90자 판정, 보강 사유 = 비지 않음). */
  done: boolean;
  disabled?: boolean;
  multiline?: boolean;
  labelKey: SheetDictKey;
  placeholderKey: SheetDictKey;
  onChange: (value: string) => void;
}) {
  const t = useSheetT();
  const tone = done ? "border-line" : "border-danger/50";
  const common = `${tone} focus:border-primary bg-background rounded-lg border px-2 text-sm outline-none disabled:opacity-50`;
  return (
    <label className="mt-1.5 flex flex-col gap-1">
      <span className={`text-xs font-bold ${done ? "text-text-faint" : "text-danger"}`}>{t(labelKey)}</span>
      {multiline ? (
        <textarea
          rows={3}
          disabled={disabled}
          value={value}
          maxLength={1000}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t(placeholderKey)}
          aria-label={t(labelKey)}
          className={`${common} py-1.5 leading-relaxed`}
        />
      ) : (
        <input
          type="text"
          disabled={disabled}
          value={value}
          maxLength={200}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t(placeholderKey)}
          aria-label={t(labelKey)}
          className={`${common} h-8`}
        />
      )}
    </label>
  );
}
