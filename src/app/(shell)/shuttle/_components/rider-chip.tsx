"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import { studentStatusLabel } from "@/features/students/status-labels";
import { SHUTTLE_DAYS, dayLabel, type ShuttleRider } from "@/features/shuttle/types";
import { compactWeekdays } from "@/features/shuttle/roster";
import { removeRider, updateRiderWeekdays } from "@/features/shuttle/server/actions";

/**
 * 배정 칩 — 학생 하나. 끌면 다른 정류장으로 옮겨지고, 학생 풀에 떨어뜨리면 배정이 풀린다.
 * 누르면 요일 편집이 펼쳐진다(makeedu가 칩마다 월~일 체크박스를 항상 펼쳐 두던 자리 —
 * 60명이 한 화면이면 체크박스만 420개라 접었다).
 *
 * ⚠️ 재원이 아닌 학생(퇴원·휴원)은 회색 + 상태 라벨로 표시하되 **자동으로 지우지 않는다**
 *    (휴원 뒤 복귀가 흔하다). 정리는 사람이 보고 뺀다.
 * ⚠️ 상태는 반드시 한글 라벨로 — raw enum(`withdrawn`)을 화면에 내보내지 않는다(CLAUDE.md).
 */
export function RiderChip({
  rider,
  canWrite,
  onError,
}: {
  rider: ShuttleRider;
  canWrite: boolean;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `rider:${rider.id}`,
    data: { type: "rider", riderId: rider.id, label: rider.studentName },
    disabled: !canWrite,
  });

  const inactive = rider.studentStatus !== "enrolled";
  const statusKo = inactive ? studentStatusLabel(rider.studentStatus) : null;

  function toggleDay(day: string) {
    const next = new Set(rider.weekdays as string[]);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    const list = SHUTTLE_DAYS.filter((d) => next.has(d));
    onError(null);
    if (list.length === 0) {
      onError("요일을 모두 끄려면 칩의 ×로 배정을 해제하세요");
      return;
    }
    const fd = new FormData();
    fd.set("id", rider.id);
    fd.set("weekdays", list.join(","));
    startTransition(async () => {
      const res = await updateRiderWeekdays(fd);
      if (res?.error) onError(res.error);
      else router.refresh();
    });
  }

  function unassign() {
    const fd = new FormData();
    fd.set("id", rider.id);
    onError(null);
    startTransition(async () => {
      const res = await removeRider(fd);
      if (res?.error) onError(res.error);
      else router.refresh();
    });
  }

  return (
    <span className={`inline-flex flex-col ${isDragging ? "opacity-50" : ""}`}>
      <span
        className={`rounded-pill inline-flex min-h-8 items-center gap-1.5 border px-2 py-1 text-[12px] sm:min-h-0 sm:gap-1 sm:py-[3px] sm:text-[11.5px] ${
          inactive
            ? "border-line bg-muted text-text-dim"
            : rider.ioKind === "in"
              ? "border-blue/30 bg-blue-soft text-blue"
              : "border-purple/30 bg-purple-soft text-purple"
        }`}
      >
        <button
          ref={setNodeRef}
          {...listeners}
          {...attributes}
          type="button"
          onClick={() => canWrite && setOpen((v) => !v)}
          className="cursor-grab touch-manipulation font-bold active:cursor-grabbing"
          title={`${rider.studentName}${rider.schoolGrade ? ` ${rider.schoolGrade}` : ""} · ${compactWeekdays(rider.weekdays)}`}
        >
          {rider.studentName}
        </button>
        <span className="opacity-75">{compactWeekdays(rider.weekdays)}</span>
        {statusKo && <span className="text-danger font-bold">{statusKo}</span>}
        {canWrite && (
          <button
            type="button"
            disabled={busy}
            onClick={unassign}
            aria-label={`${rider.studentName} 배정 해제`}
            className="hover:text-danger px-1 text-[15px] opacity-60 sm:px-0 sm:text-inherit"
          >
            ×
          </button>
        )}
      </span>

      {open && canWrite && (
        <span className="border-line bg-card mt-1 inline-flex gap-0.5 rounded-lg border p-1">
          {SHUTTLE_DAYS.map((d) => {
            const on = (rider.weekdays as string[]).includes(d);
            return (
              <button
                key={d}
                type="button"
                disabled={busy}
                onClick={() => toggleDay(d)}
                className={`size-9 rounded text-[13px] font-bold transition-colors sm:size-6 sm:text-[11px] ${
                  on ? "bg-primary text-primary-foreground" : "text-text-faint hover:bg-muted"
                }`}
              >
                {dayLabel(d)}
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}
