"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestAttendanceInput } from "@/features/attendance/live/server/actions";
import type { QueueClass } from "@/features/attendance/live/queue";
import { DeskCall } from "./desk-call";

export function DeskClassRow({ row, date, canEdit }: { row: QueueClass; date: string; canEdit: boolean }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [sent, setSent] = useState(row.requested);
  const [error, setError] = useState<string | null>(null);
  const when = row.slotCount > 1 ? `${row.slotStart}~${row.slotEnd}` : row.slotStart;
  const who = row.teacherName ?? row.slotTeacherLabel ?? "담당 미지정";

  function ask() {
    setError(null);
    setSent(true);
    startTransition(() => {
      requestAttendanceInput({ classId: row.classId, sessionDate: date, slotStart: row.saveSlot })
        .then((res) => {
          if ("error" in res) {
            setSent(row.requested);
            setError(res.error);
            return;
          }
          router.refresh();
        })
        .catch(() => {
          setSent(row.requested);
          setError("요청을 보내지 못했습니다 — 다시 눌러 주세요");
        });
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{row.className}</p>
        <p className="text-text-dim num text-xs">
          {when} · {who} · {row.expected}명
        </p>
        {/* 강사가 먼저 손을 든 반 — 이 카드의 '요청'(강사에게 입력 요청)은 무의미하다(강사가 이미 안다). */}
        {row.teacherRequested && (
          <p className="text-amber-strong text-xs font-semibold">강사가 데스크 확인을 요청했습니다</p>
        )}
        {error && <p className="text-danger text-xs">{error}</p>}
      </div>
      <div className="flex items-center gap-2">
        <DeskCall phone={row.teacherPhone} label="강사" />
        {canEdit &&
          (sent ? (
            <span className="text-text-faint text-xs font-bold">요청함</span>
          ) : (
            <button
              type="button"
              onClick={ask}
              disabled={busy}
              className="bg-primary text-primary-foreground rounded-lg px-2.5 py-1 text-xs font-bold disabled:opacity-60"
            >
              요청
            </button>
          ))}
      </div>
    </div>
  );
}
