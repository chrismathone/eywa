"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, X } from "@/components/icons/aywa-icon-compat";
import { scheduledImportLabel } from "@/features/timetable/scheduled-import";
import { cancelScheduledImport } from "@/features/timetable/server/scheduled-import-actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";

/**
 * 툴바의 **"9/1 시간표 적용 예정"** 배지 (원장 2026-08-28).
 *
 * 미래 날짜로 가져오기를 적용해 두면 **이번 주 화면은 그대로**라 아무 흔적이 없다 — 그래서 주 네비 옆에
 * 상시로 붙인다. 라벨을 누르면 연동된 구글 시트가 열리고(원장 *"aywa 2.0 영어시간표 시트로 가서 9월
 * 시간표를 보여주는거야"*), 옆 **×**가 그 예약을 통째로 되돌린다(*"모든게 무로 돌아가는거야"*).
 *
 * ⚠️ 되돌리기는 **날짜 단위**다 — 한 번의 적용이 배치·반이동 스냅샷을 둘 만들기 때문에 하나만 되돌리면
 *    배치와 명단이 어긋난다(묶는 규칙은 `scheduled-import.ts`).
 * ⚠️ × 노출은 게이트가 아니다 — 서버 액션이 같은 권한·같은 "미래분만" 조건을 다시 본다(#77).
 */
export function ScheduledImportBadge({
  effectiveDate,
  today,
  sheetUrl,
  canCancel,
}: {
  effectiveDate: string;
  today: string;
  /** 연동된 구글 시트 URL(있을 때만 라벨이 링크가 된다). */
  sheetUrl?: string | null;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = scheduledImportLabel(effectiveDate, today);

  function cancel() {
    if (!confirm(`${label} — 이 예약을 취소하고 원래대로 되돌릴까요?\n적용 전이라 아무 기록도 남지 않습니다.`)) return;
    setError(null);
    start(async () => {
      const res = await cancelScheduledImport(effectiveDate);
      // 일부만 되돌리고 남긴 경우(`reverted` + 안내 문구)도 이미 바뀐 것이 있다 — 회차 확정 창에 알린다.
      if (res.reverted || !res.error) notifyTermPlansChanged();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  const inner = (
    <>
      <CalendarClock size={12} aria-hidden="true" />
      <span className="num">{label}</span>
    </>
  );

  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <span className="border-blue/40 bg-blue-soft text-blue inline-flex items-center gap-1 rounded-pill border py-0.5 pr-1 pl-2 text-xs font-bold">
        {sheetUrl ? (
          // 시트를 새 창으로 — 시간표 화면(창 안 iframe)을 떠나지 않게 한다.
          <a
            href={sheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="연결된 구글 시트 열기"
            className="inline-flex items-center gap-1 hover:underline"
          >
            {inner}
          </a>
        ) : (
          <span className="inline-flex items-center gap-1">{inner}</span>
        )}
        {canCancel ? (
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            aria-label={`${label} 취소`}
            title="예약 취소 — 원래대로 되돌립니다"
            className="hover:bg-blue/15 ml-0.5 rounded-full p-0.5 transition disabled:opacity-40"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
          </button>
        ) : null}
      </span>
      {/* ⚠️ 실패 사유는 보이는 문구로 — 배지 옆 작은 × 의 title은 눌러 본 뒤엔 안 읽힌다. */}
      {error ? <span className="text-danger max-w-[22rem] text-xs">{error}</span> : null}
    </span>
  );
}
