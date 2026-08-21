"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { studentStatusLabel } from "@/features/students/status-labels";
import { SHUTTLE_DENSE_TEXT } from "@/features/shuttle/control-size";
import { SHUTTLE_DAYS, dayLabel, type ShuttleRider } from "@/features/shuttle/types";
import { compactWeekdays } from "@/features/shuttle/roster";
import { removeRider, updateRiderWeekdays } from "@/features/shuttle/server/actions";

/**
 * 배정 칩 — 학생 하나. 끌면 다른 정류장으로 옮겨지고, 학생 풀에 떨어뜨리면 배정이 풀린다.
 *
 * 🔑 **요일은 이 칩에서 정한다**(원장 2026-08-19: *"드래그드랍할 때 요일 설정하는게 없는거 같은데
 *    요일 어디서?"*). 끌어다 놓으면 일단 **평일**로 들어가고, 칩의 **요일 글자를 누르면** 월~일
 *    토글이 펼쳐진다. 전에는 이름을 눌러야 열려서 아무도 못 찾았다 — 요일을 바꾸려는 사람의 눈은
 *    요일 글자에 가 있다(점선 밑줄로 "누를 수 있음"을 표시).
 *    makeedu처럼 체크박스를 늘 펼쳐 두지는 않는다(60명이면 체크박스만 420개).
 *
 * 🔑 **칸 안에서 이름·요일·×의 자리가 고정**된다(원장: *"라벨이 항상 같은 위치에 있으면 좋겠다"*) —
 *    부모가 균일 폭 그리드라 요일과 ×가 모든 칩에서 같은 x에 선다. 그래서 폭을 꽉 채운다(`w-full`).
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
  const daysKo = compactWeekdays(rider.weekdays);

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
    <span className={`flex w-full min-w-0 flex-col ${isDragging ? "opacity-50" : ""}`}>
      <span
        // 📱 폰은 44px(셔틀 탭 타겟 규칙) — 데스크톱은 격자 밀도 요소라 종전대로 촘촘하게
        //    (control-size의 "의도된 예외 하나"). 글자도 같은 축(SHUTTLE_DENSE_TEXT)에서 온다.
        className={cn(
          "rounded-pill flex min-h-11 w-full min-w-0 items-center gap-1.5 border px-2 py-1 sm:min-h-0 sm:gap-1 sm:py-[3px]",
          SHUTTLE_DENSE_TEXT,
          
          inactive
            ? "border-line bg-muted text-text-dim"
            : rider.ioKind === "in"
              ? "border-blue/30 bg-blue-soft text-blue"
              : "border-purple/30 bg-purple-soft text-purple",
        )}
      >
        <button
          ref={setNodeRef}
          {...listeners}
          {...attributes}
          type="button"
          className="min-w-0 cursor-grab touch-manipulation overflow-hidden text-ellipsis whitespace-nowrap font-bold active:cursor-grabbing"
          title={`${rider.studentName}${rider.schoolGrade ? ` ${rider.schoolGrade}` : ""} · ${daysKo} (끌어서 다른 정류장으로)`}
        >
          {rider.studentName}
        </button>
        {statusKo && <span className="text-danger shrink-0 font-bold">{statusKo}</span>}
        {/* 요일 = 편집 손잡이. 오른쪽에 붙여 칩마다 같은 자리에 서게 한다. */}
        {canWrite ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title="요일 변경"
            className="ml-auto shrink-0 cursor-pointer underline decoration-dotted underline-offset-2 opacity-75 hover:opacity-100"
          >
            {daysKo}
          </button>
        ) : (
          <span className="ml-auto shrink-0 opacity-75">{daysKo}</span>
        )}
        {canWrite && (
          <button
            type="button"
            disabled={busy}
            onClick={unassign}
            aria-label={`${rider.studentName} 배정 해제`}
            // 폰에서는 칩 높이(44px)를 그대로 받아 손가락이 닿는 칸이 된다 — 폭까지 44로 키우면
            // 9rem 칸에서 이름이 사라지므로 세로만 채우고 좌우는 여백으로 넓힌다.
            className="hover:text-danger h-11 shrink-0 cursor-pointer px-2 text-[15px] opacity-60 sm:h-auto sm:px-0 sm:text-inherit"
          >
            ×
          </button>
        )}
      </span>

      {open && canWrite && (
        <span className="border-line bg-card mt-1 flex flex-wrap items-center gap-0.5 rounded-lg border p-1">
          {SHUTTLE_DAYS.map((d) => {
            const on = (rider.weekdays as string[]).includes(d);
            return (
              <button
                key={d}
                type="button"
                disabled={busy}
                aria-pressed={on}
                onClick={() => toggleDay(d)}
                className={`size-11 cursor-pointer rounded text-[13px] font-bold transition-colors sm:size-6 sm:text-[11.5px] ${
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
