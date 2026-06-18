"use client";

import { useState, useTransition } from "react";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import type { AttendanceStatus } from "@/features/attendance/server/queries";

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "O",
  absent: "X",
  late: "L",
  excused: "공",
  makeup: "보",
  early_leave: "조",
};
const STATUS_CLASS: Record<AttendanceStatus, string> = {
  present: "bg-primary-soft text-primary",
  absent: "bg-danger-soft text-danger",
  late: "bg-amber-soft text-amber",
  excused: "bg-blue-soft text-blue",
  makeup: "bg-purple-soft text-purple",
  early_leave: "bg-rose-soft text-rose",
};
const OPTIONS: { value: AttendanceStatus; name: string }[] = [
  { value: "present", name: "출석" },
  { value: "absent", name: "결석" },
  { value: "late", name: "지각" },
  { value: "early_leave", name: "조퇴" },
  { value: "excused", name: "공결" },
  { value: "makeup", name: "보강" },
];

/**
 * 출석부 매트릭스 인라인 셀 — 클릭 시 상태 팝오버, 낙관적 업데이트 후 단일 셀 저장.
 * 페이지 이동 없이 빠르게 출결을 찍는다(반응속도 1순위). 메모·숙제 상세는 일자 입력 화면에서.
 */
export function AttendanceCell({
  studentId,
  classId,
  sessionDate,
  initialStatus,
  isWeekend,
  note,
}: {
  studentId: string;
  classId: string;
  sessionDate: string;
  initialStatus: AttendanceStatus | null;
  isWeekend: boolean;
  note?: string | null;
}) {
  const [status, setStatus] = useState<AttendanceStatus | null>(initialStatus);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [, startTransition] = useTransition();

  const apply = (next: AttendanceStatus | null) => {
    const prev = status;
    setStatus(next); // 낙관적
    setOpen(false);
    startTransition(async () => {
      const res = await setAttendanceCell({ studentId, classId, sessionDate, status: next });
      if ("error" in res) setStatus(prev); // 실패 시 롤백
    });
  };

  const cls = status ? STATUS_CLASS[status] : "";
  const label = status ? STATUS_LABEL[status] : "·";

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setPos({ x: r.left, y: r.bottom });
          setOpen(true);
        }}
        title={note ?? undefined}
        className={`relative block size-7 leading-7 font-mono text-[11px] font-bold ${cls} ${
          status ? "" : `text-text-faint hover:bg-bg-soft ${isWeekend ? "bg-bg-soft/40" : ""}`
        }`}
        aria-label={note ? `출결 상태 변경 (메모: ${note})` : "출결 상태 변경"}
      >
        {label}
        {note ? (
          <span
            className="border-t-danger absolute top-0 right-0 size-0 border-t-[5px] border-l-[5px] border-l-transparent"
            aria-hidden
          />
        ) : null}
      </button>

      {open && pos ? (
        <>
          {/* 바깥 클릭 닫기 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="bg-card border-line fixed z-50 flex flex-col gap-0.5 rounded-md border p-1 shadow-lg"
            style={{ left: Math.min(pos.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 132), top: pos.y + 4 }}
          >
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => apply(o.value)}
                className={`flex items-center gap-2 rounded-sm px-2 py-1 text-left text-xs transition hover:bg-bg-soft ${
                  status === o.value ? "font-bold" : ""
                }`}
              >
                <span
                  className={`inline-flex size-5 items-center justify-center rounded-sm font-mono text-[11px] font-bold ${STATUS_CLASS[o.value]}`}
                >
                  {STATUS_LABEL[o.value]}
                </span>
                {o.name}
              </button>
            ))}
            {status ? (
              <button
                type="button"
                onClick={() => apply(null)}
                className="text-text-dim hover:bg-bg-soft mt-0.5 rounded-sm border-t px-2 py-1 text-left text-xs"
              >
                지우기
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
