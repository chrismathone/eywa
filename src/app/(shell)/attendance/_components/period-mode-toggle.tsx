"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { saveAttendancePeriodMode } from "@/features/attendance/server/prefs-actions";
import type { PeriodMode } from "@/features/attendance/view-prefs";

const MODE_OPTIONS: { value: PeriodMode; label: string }[] = [
  { value: "session", label: "세션" },
  { value: "month", label: "월" },
];

/**
 * 날짜축 전환 — 세션 기간(0189a) / 달력월. `기간: 세션` 드롭다운(지시서 §10, 2026-09-04 12단계: 옛 세그먼트 2칩 + 12px 글자).
 *
 * ⚠️ URL 파라미터로 만들지 않는다: 출석부의 범위 파라미터는 폐기됐고(원장 2026-08-06, att-href.ts),
 *    "모든 뷰 세팅은 계정 귀속"이라 `users.ui_prefs.attendance.periodMode`에 저장한다(#90).
 *    서버가 날짜축을 확정해 내려주므로 저장 후 `router.refresh()`가 필요하다(sort-select와 같은 규약).
 *
 * ⚠️ 이건 **표시 렌즈**일 뿐이다. 청구·시수검증·급여는 이 설정을 읽지 않는다 —
 *    계정마다 금액이 달라 보이면 안 된다.
 * ⚠️ 세션을 못 쓰는 상황(강사 전체 보기·반 미선택)엔 고르는 것 자체를 잠그고 사유를 옆에 적는다 — 잠긴 드롭다운은
 *    같은 모양의 글자 상자로 서고(`title`에도 사유), 열리지 않는다.
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
  const [pending, startTransition] = useTransition();
  const label = MODE_OPTIONS.find((o) => o.value === mode)?.label ?? "월";

  return (
    <div className="flex shrink-0 items-center gap-1.5" title={disabledReason ?? windowLabel}>
      {disabledReason ? (
        <span aria-disabled="true" className={`${TOOLBAR_SELECT} cursor-not-allowed opacity-60`}>
          기간: {label}
        </span>
      ) : (
        <span className={pending ? "opacity-60" : ""}>
          <SearchableSelect
            options={MODE_OPTIONS}
            value={mode}
            onValueChange={(v) => {
              const next = v === "session" ? "session" : "month";
              if (next === mode || pending) return;
              startTransition(async () => {
                await saveAttendancePeriodMode(next);
                router.refresh();
              });
            }}
            ariaLabel="날짜축 전환"
            valuePrefix="기간"
            triggerClassName={TOOLBAR_SELECT}
            className="w-auto"
          />
        </span>
      )}
      <span className="text-text-faint max-w-[220px] truncate text-xs">{disabledReason ?? windowLabel}</span>
    </div>
  );
}
