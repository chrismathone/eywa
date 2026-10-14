"use client";

import type { ChurnOptions } from "@/features/teacher-portfolio/evaluation/config";
import { REASON_LABEL, WITHDRAWAL_REASONS } from "@/features/withdrawals/types";

/**
 * 퇴원율의 세는 법(원장 결정 6) — 강사 탓이 아닌 퇴원 사유를 골라 뺀다 · 수강종료(다른 과목은 다님)도 셀지.
 * 반 이동 · 수업이 끝남(반 폐지·종강) · 끝난 특강 · 같은 과목 다른 반은 늘 뺀다(퇴원관리와 같은 규칙 — 고르는 칸이 아니다).
 * ⚠️ 이 칸은 학생을 **세는** 법이라 미리보기(저장된 수치에 점수 규칙만 얹는다)엔 안 보이고, 저장 뒤 다시 매긴 점수에 반영된다.
 */
export function ChurnOptionsEditor({ value, onChange, label }: { value: ChurnOptions; onChange: (next: ChurnOptions) => void; label: string }) {
  const toggle = (code: string, on: boolean) =>
    onChange({ ...value, excludeReasons: on ? [...new Set([...value.excludeReasons, code])] : value.excludeReasons.filter((c) => c !== code) });
  return (
    <fieldset className="space-y-2 rounded-lg border border-line-faint px-3 py-2.5">
      <legend className="px-1 text-sm font-medium">세는 법</legend>
      <p className="text-xs">퇴원율에서 뺄 퇴원 사유(강사 탓이 아닌 퇴원 — 시간표 X 퇴원 카드 · 급여명세서 퇴원생률에서도 빼고, 학생 배정·유지에서도 −1을 하지 않습니다):</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {WITHDRAWAL_REASONS.map((code) => (
          <label key={code} className="flex items-center gap-1.5">
            <input type="checkbox" className="size-4" aria-label={`${label} — ${REASON_LABEL[code]} 사유 빼기`}
              checked={value.excludeReasons.includes(code)} onChange={(e) => toggle(code, e.target.checked)} />
            {REASON_LABEL[code]}
          </label>
        ))}
      </div>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" className="size-4" checked={value.countEnded} onChange={(e) => onChange({ ...value, countEnded: e.target.checked })} />
        수강종료(다른 과목은 계속 다님)도 그만둔 것으로 센다
      </label>
      <p className="text-xs">반 이동·수업이 끝남(반 폐지·종강)·끝난 특강·같은 과목의 다른 반으로 옮긴 경우는 늘 뺍니다. 이 칸을 바꾸면 미리보기엔 보이지 않고, 저장한 뒤 다시 매긴 점수에 반영됩니다.</p>
    </fieldset>
  );
}
