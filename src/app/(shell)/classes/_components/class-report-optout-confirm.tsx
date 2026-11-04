"use client";

import {
  REPORT_OPTOUT_CONFIRM_LABEL,
  REPORT_OPTOUT_CONFIRM_REQUIRED,
  reportOptoutWarning,
} from "@/features/classes/report-optout-warning";

/**
 * '수업보고서 미발송'을 켜는 순간의 경고 + 확인 체크(2026-11-04 사고 — 보내던 반을 미발송으로 바꿔 보고서 칸이 잠겼다).
 * 언제 뜨는지는 `needsReportOptoutConfirm`(report-optout-warning.ts)이 정하고, 부모(class-report-fields.tsx)가 그릴 때만 그린다.
 *
 * 확인 방식 = **체크해야 저장된다**: 확인 칸이 `required`라 체크 없이 저장(버튼·Enter)을 누르면 브라우저가 제출을 막고
 * 이 칸으로 데려가 안내를 띄운다. 이름 충돌의 '그 반 이름을 바꾸고 저장' 버튼은 폼을 직접 보내므로 그 자리에서
 * `form.reportValidity()`로 같은 검사를 거친다(class-form.tsx `freeClosedName`). 서버는 막지 않는다(원장이 고를 수 있는 설정).
 *
 * 🔴 확인 칸에 **이름(name)을 주지 않는다** — 서버로 가지 않고, 초안 자동저장(useFormDraft는 name 있는 칸만 담는다)에도
 *    안 남는다. 초안을 되살려 미발송이 다시 켜져도 확인은 새로 받는다. 토글을 껐다 켜도 이 상자가 새로 그려져 체크가 풀린다.
 */
export function ClassReportOptoutConfirm({ recentSent, boardRoute }: { recentSent: number | null; boardRoute: boolean }) {
  return (
    <div
      role="alert"
      className="border-danger/30 bg-danger-soft text-danger space-y-2 rounded-lg border px-3 py-2 text-xs break-keep"
    >
      <p className="font-semibold">미발송으로 바꾸기 전에 확인해 주세요</p>
      <p>{reportOptoutWarning(recentSent, boardRoute)}</p>
      <label className="flex w-fit cursor-pointer items-center gap-2 font-medium">
        <input
          type="checkbox"
          required
          // 브라우저 기본 문구 대신 무엇을 해야 하는지 — 체크하면 바로 지운다(안 지우면 체크해도 계속 막힌다).
          onInvalid={(e) => e.currentTarget.setCustomValidity(REPORT_OPTOUT_CONFIRM_REQUIRED)}
          onChange={(e) => e.currentTarget.setCustomValidity("")}
          className="size-4 shrink-0"
        />
        {REPORT_OPTOUT_CONFIRM_LABEL}
      </label>
    </div>
  );
}
