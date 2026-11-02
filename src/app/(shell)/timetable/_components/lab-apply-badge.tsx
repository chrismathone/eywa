"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, X } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { labApplyLabel } from "@/features/timetable-lab/apply-time";
import { cancelTimetableLabApplyJob } from "@/features/timetable-lab/server/apply-actions";

/**
 * 툴바의 **"11/2 16시 연습본 적용 예정"** 배지(원장 2026-11-02: *"마치 안된것처럼 보이잖아"*).
 *
 * 연습본 예약은 실행 전까지 운영 자료에 쓰지 않아 시간표에 흔적이 없다 — 시트 반영 배지
 * (`ScheduledImportBadge`)와 같은 자리·모양으로 상시 붙인다. 라벨을 누르면 편집기의 적용 내역이 열린다.
 *
 * ⚠️ × 노출은 게이트가 아니다 — 서버 액션이 같은 권한·예약한 본인·아직 실행 전인지를 다시 본다(#77).
 */
export function LabApplyBadge({
  id,
  at,
  today,
  canCancel,
}: {
  id: string;
  /** 적용 시각(ISO). */
  at: string;
  today: string;
  /** 예약한 본인일 때만 취소할 수 있다. */
  canCancel: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = labApplyLabel(at, today);

  function cancel() {
    if (!confirm(`${label} — 이 예약을 취소할까요?\n적용 전이라 운영 시간표는 바뀌지 않습니다.`)) return;
    setError(null);
    start(async () => {
      const res = await cancelTimetableLabApplyJob(id);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <span className="border-blue/40 bg-blue-soft text-blue inline-flex items-center gap-1 rounded-pill border py-0.5 pr-1 pl-2 text-xs font-bold">
        <WindowLink
          href="/timetable/editor?history=1"
          title="시간표 편집기"
          frameTarget="window"
          className="inline-flex items-center gap-1 hover:underline"
        >
          <CalendarClock size={12} aria-hidden="true" />
          <span className="num">{label}</span>
        </WindowLink>
        {canCancel ? (
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            aria-label={`${label} 취소`}
            title="예약 취소"
            className="hover:bg-blue/15 ml-0.5 rounded-full p-0.5 transition disabled:opacity-40"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
          </button>
        ) : null}
      </span>
      {error ? <span className="text-danger max-w-[22rem] text-xs">{error}</span> : null}
    </span>
  );
}
