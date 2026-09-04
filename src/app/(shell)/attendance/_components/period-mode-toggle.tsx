"use client";

import { TOOLBAR_SEG_BOX } from "@/components/toolbar-controls";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAttendancePeriodMode } from "@/features/attendance/server/prefs-actions";
import type { PeriodMode } from "@/features/attendance/view-prefs";
import { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * 날짜축 전환 — 세션 기간(0189a) / 달력월.
 *
 * ⚠️ URL 파라미터로 만들지 않는다: 출석부의 범위 파라미터는 폐기됐고(원장 2026-08-06, att-href.ts),
 *    "모든 뷰 세팅은 계정 귀속"이라 `users.ui_prefs.attendance.periodMode`에 저장한다(#90).
 *    서버가 날짜축을 확정해 내려주므로 저장 후 `router.refresh()`가 필요하다(sort-select와 같은 규약).
 *
 * ⚠️ 이건 **표시 렌즈**일 뿐이다. 청구·시수검증·급여는 이 설정을 읽지 않는다 —
 *    계정마다 금액이 달라 보이면 안 된다.
 */
export function PeriodModeToggle({
  mode,
  windowLabel,
  disabledReason,
}: {
  mode: PeriodMode;
  /** 지금 실제로 그린 기간("2026년 3월 세션 (3/6~4/2)" 또는 "2026년 3월"). */
  windowLabel: string;
  /** 세션을 못 쓰는 상황이면 그 이유(있으면 토글을 잠그고 사유를 보여준다). */
  disabledReason?: string;
}) {
  const router = useRouter();
  const t = useSheetT();
  const [pending, startTransition] = useTransition();

  const pick = (next: PeriodMode) => {
    if (next === mode || pending || disabledReason) return;
    startTransition(async () => {
      await saveAttendancePeriodMode(next);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-1.5" title={disabledReason ?? windowLabel}>
      <div
        className={`${TOOLBAR_SEG_BOX} ${pending ? "opacity-60" : ""}`}
        role="group"
        aria-label={t("att.period.aria")}
      >
        {(["session", "month"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => pick(m)}
            disabled={!!disabledReason || pending}
            aria-pressed={mode === m}
            className={`rounded-md px-2 py-1 text-[11px] font-bold transition-colors ${
              mode === m ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
            } ${disabledReason ? "cursor-not-allowed" : ""}`}
          >
            {t(m === "session" ? "att.period.session" : "att.period.month")}
          </button>
        ))}
      </div>
      <span className="text-text-faint max-w-[220px] truncate text-[11px]">{disabledReason ?? windowLabel}</span>
    </div>
  );
}
