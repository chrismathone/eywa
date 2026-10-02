"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "@/components/icons/aywa-icon-compat";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { ScheduledChange } from "@/features/enrollments/scheduled-changes";
import {
  cancelScheduledEnrollment,
  rescheduleEnrollment,
} from "@/features/enrollments/server/scheduled-actions";
import { notifyTermPlansChanged } from "@/features/billing/session-terms/plan-change-signal";

/**
 * 예정된 변경의 **수정·취소** 버튼(원장 2026-08-28 스케치: 배너 우측 끝).
 *
 * ⚠️ 서버가 진짜 게이트다 — 여기서 버튼을 감추는 것은 게이트가 아니다([[#77]]). 이미 시작된 예약·
 *    권한 없는 사용자는 서버가 거절하고, 그 한글 사유를 그대로 보여 준다.
 * ⚠️ 종료 예정(`canCancel:false`)에는 취소를 안 준다 — 퇴원 예정을 되살리는 버튼이 된다.
 */
export function ScheduledChangeActions({
  change,
  /**
   * 오늘(KST) — 🔴 **서버가 내려준다.** 클라 `new Date()`로 계산하면 타임존이 어긋나 자정 근처에서
   * 하루가 밀리고, 서버가 거절할 날짜를 화면이 허용한다(시간표 적용일 규칙과 같은 이유).
   */
  today,
  /** 대상 반을 바꿀 수 있게 하려면 후보를 넘긴다(반 상세에선 생략 — 그 화면의 축이 아니다). */
  classOptions,
}: {
  change: ScheduledChange;
  today: string;
  classOptions?: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      try {
        const res = await fn();
        if (res.error) setError(res.error);
        else {
          setOpen(false);
          notifyTermPlansChanged();
          router.refresh();
        }
      } catch {
        setError("처리 결과를 확인하지 못했습니다. 새로고침 후 예약 상태를 확인해 주세요.");
      }
    });

  if (!change.canCancel) {
    return change.blockedReason ? <span className="text-text-dim text-xs">{change.blockedReason}</span> : null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="text-text-dim hover:text-blue hover:border-blue/30 hover:bg-blue/10 rounded-lg border border-transparent px-2 py-1 text-xs whitespace-nowrap transition"
      >
        수정
      </button>
      <button
        type="button"
        onClick={() =>
          run(() =>
            cancelScheduledEnrollment({
              enrollmentId: change.enrollmentId,
              pairedEnrollmentId: change.pairedEnrollmentId,
            }),
          )
        }
        disabled={pending}
        title={change.kind === "move" ? "이 반 이동을 취소하고 이전 반 수강을 복구합니다" : "이 배정 예약을 취소합니다"}
        className="text-text-dim hover:text-danger hover:border-danger/30 hover:bg-danger/10 inline-flex items-center gap-1 rounded-lg border border-transparent px-2 py-1 text-xs whitespace-nowrap transition"
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
        취소
      </button>

      {open ? (
        <EditRow
          change={change}
          today={today}
          classOptions={classOptions}
          pending={pending}
          onSubmit={(date, newClassId) =>
            run(() =>
              rescheduleEnrollment({
                enrollmentId: change.enrollmentId,
                pairedEnrollmentId: change.pairedEnrollmentId,
                date,
                newClassId,
              }),
            )
          }
        />
      ) : null}
      {error ? (
        <span role="alert" className="text-danger max-w-[24rem] text-xs">
          {error}
        </span>
      ) : null}
    </>
  );
}

function EditRow({
  change,
  today,
  classOptions,
  pending,
  onSubmit,
}: {
  change: ScheduledChange;
  today: string;
  classOptions?: { value: string; label: string }[];
  pending: boolean;
  onSubmit: (date: string, newClassId?: string) => void;
}) {
  const [date, setDate] = useState(change.date);
  const [classId, setClassId] = useState(change.classId);
  // 예약은 **내일 이후**만 — 서버도 같은 조건으로 거절한다(화면은 그 거울일 뿐).
  // 서버가 준 오늘에 하루를 더한다(UTC 산술이라 TZ 드리프트 없음).
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const min = tomorrow.toISOString().slice(0, 10);

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <input
        type="date"
        aria-label="예약 적용일"
        value={date}
        min={min}
        onChange={(e) => setDate(e.target.value)}
        disabled={pending}
        className="border-line bg-card rounded-lg border px-2 py-1 text-xs"
      />
      {classOptions && classOptions.length > 0 ? (
        <span className="min-w-[10rem]">
          <SearchableSelect
            value={classId}
            onValueChange={setClassId}
            options={classOptions}
            placeholder="반 선택"
          />
        </span>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => onSubmit(date, classOptions ? classId : undefined)}
        className="bg-primary text-primary-foreground rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
      >
        {pending ? "저장 중…" : "저장"}
      </button>
    </span>
  );
}
