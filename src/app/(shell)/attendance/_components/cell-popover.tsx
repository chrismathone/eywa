"use client";

import { useState, useTransition } from "react";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import type { AttendanceStatus } from "@/features/attendance/server/queries";
import { parseSessionUnits } from "@/features/attendance/session-units";
import { STATUS_TONE } from "@/features/attendance/cell-display";

const OPTIONS: { value: AttendanceStatus; name: string }[] = [
  { value: "present", name: "출석" },
  { value: "absent", name: "결석" },
  { value: "late", name: "지각" },
  { value: "early_leave", name: "조퇴" },
  { value: "makeup", name: "보강" },
];

export type PopoverAnchor = { x: number; top?: number; bottom?: number };

/**
 * 칸 상세 입력 — **숫자로 표현할 수 없는 것**(지각·조퇴·보강·메모)을 담당한다.
 * 출석(1)·결석(0)·시수는 격자에서 그냥 타이핑하는 게 빠르므로 여기 오지 않아도 된다.
 * 여는 법: 칸 더블클릭 또는 우클릭.
 */
export function CellPopover({
  studentId,
  classId,
  sessionDate,
  status,
  units,
  note,
  anchor,
  onClose,
  onSaved,
}: {
  studentId: string;
  classId: string;
  sessionDate: string;
  status: AttendanceStatus | null;
  units: number | null;
  note: string;
  anchor: PopoverAnchor;
  onClose: () => void;
  onSaved: (next: { status: AttendanceStatus | null; units: number | null; note: string }) => void;
}) {
  const [unitsDraft, setUnitsDraft] = useState(units !== null && units !== 1 ? String(units) : "");
  const [noteDraft, setNoteDraft] = useState(note);
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const apply = (next: AttendanceStatus | null, withNote: boolean) => {
    let parsedUnits: number | null = null;
    if (next !== null) {
      const parsed = parseSessionUnits(unitsDraft);
      if (!parsed.ok) {
        setErr(parsed.error);
        return;
      }
      parsedUnits = parsed.value;
    }
    setErr(null);
    onSaved({ status: next, units: parsedUnits, note: next === null ? "" : withNote ? noteDraft.trim() : note });
    onClose();
    startTransition(async () => {
      const res = await setAttendanceCell({
        studentId,
        classId,
        sessionDate,
        status: next,
        ...(next === null ? {} : { units: unitsDraft, ...(withNote ? { note: noteDraft } : {}) }),
      });
      // 실패하면 격자를 원래 값으로 되돌린다(저장된 척 두지 않는다).
      if (res && "error" in res) onSaved({ status, units, note });
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="출결 상세 입력"
        // ⚠️ role="dialog" 는 접근성 표시이자 **격자 키 가로채기 방지 신호**다(grid-context의 가드가 이걸 본다).
        className="bg-card border-line fixed z-50 flex w-44 flex-col gap-0.5 rounded-lg border p-1 shadow-lg"
        style={{
          left: Math.min(anchor.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 190),
          top: anchor.top,
          bottom: anchor.bottom,
        }}
      >
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => apply(o.value, false)}
            className={`hover:bg-bg-soft flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-xs transition ${
              status === o.value ? "font-bold" : ""
            }`}
          >
            {o.name}
            <span className={`border-line size-4 shrink-0 rounded-sm border ${STATUS_TONE[o.value]}`} aria-hidden />
          </button>
        ))}
        <div className="border-line mt-0.5 flex flex-col gap-1 border-t pt-1">
          <input
            type="text"
            inputMode="decimal"
            value={unitsDraft}
            onChange={(e) => {
              setUnitsDraft(e.target.value);
              setErr(null);
            }}
            placeholder="시수(기본 1)"
            aria-label="시수"
            title="정규 수업 1회 = 1. 보강 연장 1.5·2, 부분 출석 0.5 등"
            className={`bg-bg-soft text-foreground placeholder:text-text-faint w-full rounded-md border px-2 py-1 text-xs focus:outline-none ${
              err ? "border-danger" : "border-line"
            }`}
          />
          {err ? <p className="text-danger text-[10px] leading-tight">{err}</p> : null}
          <input
            type="text"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="메모(사유)"
            aria-label="메모(사유)"
            className="border-line bg-bg-soft text-foreground placeholder:text-text-faint w-full rounded-md border px-2 py-1 text-xs focus:outline-none"
          />
          <button
            type="button"
            onClick={() => apply(status, true)}
            disabled={!status}
            className="bg-foreground text-background rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-40"
            title={status ? undefined : "상태를 먼저 선택하세요"}
          >
            저장
          </button>
        </div>
        {status ? (
          <button
            type="button"
            onClick={() => apply(null, false)}
            className="text-text-dim hover:bg-bg-soft rounded-md border-t px-2 py-1 text-left text-xs"
          >
            지우기
          </button>
        ) : null}
      </div>
    </>
  );
}
