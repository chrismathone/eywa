"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Clock, Loader2, Mail, RotateCcw, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  saveAttendance,
  type SaveAttendanceState,
} from "@/features/attendance/server/actions";
import type {
  AttendanceInputRow,
  AttendanceStatus,
} from "@/features/attendance/server/queries";

const STATUS_DEFS: {
  value: AttendanceStatus;
  label: string;
  icon: typeof Check;
  activeClass: string;
}[] = [
  {
    value: "present",
    label: "출석",
    icon: Check,
    activeClass: "text-chart-2 bg-chart-2/10 border-chart-2/30",
  },
  {
    value: "absent",
    label: "결석",
    icon: X,
    activeClass: "text-chart-4 bg-chart-4/10 border-chart-4/30",
  },
  {
    value: "late",
    label: "지각",
    icon: Clock,
    activeClass: "text-chart-3 bg-chart-3/10 border-chart-3/30",
  },
  {
    value: "excused",
    label: "공결",
    icon: Mail,
    activeClass: "text-muted-foreground bg-muted border-border",
  },
  {
    value: "makeup",
    label: "보강",
    icon: RotateCcw,
    activeClass: "text-chart-1 bg-chart-1/10 border-chart-1/30",
  },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      저장
    </Button>
  );
}

export function AttendanceInputForm({
  classId,
  date,
  rows,
}: {
  classId: string;
  date: string;
  rows: AttendanceInputRow[];
}) {
  const [state, formAction] = useActionState<SaveAttendanceState, FormData>(saveAttendance, undefined);
  const [pending, setPending] = useState<Record<string, AttendanceStatus | null>>(() => {
    const init: Record<string, AttendanceStatus | null> = {};
    for (const r of rows) init[r.studentId] = r.status;
    return init;
  });

  function setOne(studentId: string, status: AttendanceStatus | null) {
    setPending((p) => ({ ...p, [studentId]: status }));
  }

  function setAll(status: AttendanceStatus) {
    setPending((p) => {
      const next = { ...p };
      for (const r of rows) next[r.studentId] = status;
      return next;
    });
  }

  function clearAll() {
    setPending((p) => {
      const next = { ...p };
      for (const r of rows) next[r.studentId] = null;
      return next;
    });
  }

  const dirty = rows.some((r) => pending[r.studentId] !== r.status);
  const filled = rows.filter((r) => pending[r.studentId] != null).length;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="classId" value={classId} />
      <input type="hidden" name="date" value={date} />

      {/* Bulk actions */}
      <div className="border-border bg-card flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5">
        <div className="text-muted-foreground text-xs">
          입력 {filled} / {rows.length}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAll("present")}
            className="text-chart-2 hover:bg-chart-2/10 rounded-md px-2 py-1 text-xs font-medium transition"
          >
            전체 출석
          </button>
          <span className="text-muted-foreground/40 text-xs">·</span>
          <button
            type="button"
            onClick={clearAll}
            className="text-muted-foreground hover:text-foreground rounded-md px-2 py-1 text-xs transition"
          >
            전체 초기화
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="border-border bg-muted/20 rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">이 날짜에 활성 재원생이 없습니다.</p>
        </div>
      ) : (
        <ul className="bg-card border-border divide-border divide-y rounded-lg border">
          {rows.map((r) => {
            const current = pending[r.studentId];
            return (
              <li
                key={r.studentId}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-foreground text-sm font-medium">{r.studentName}</span>
                  {r.studentGrade ? (
                    <span className="text-muted-foreground text-xs">{r.studentGrade}</span>
                  ) : null}
                  {r.existingRecordId ? (
                    <span className="text-muted-foreground text-[10px]">· 이전 기록 있음</span>
                  ) : null}
                </div>

                <input
                  type="hidden"
                  name={`existing:${r.studentId}`}
                  value={r.existingRecordId ?? ""}
                />
                <input
                  type="hidden"
                  name={`status:${r.studentId}`}
                  value={current ?? ""}
                />

                <div className="inline-flex items-center gap-1">
                  {STATUS_DEFS.map((s) => {
                    const Icon = s.icon;
                    const active = current === s.value;
                    return (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => setOne(r.studentId, active ? null : s.value)}
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition ${
                          active
                            ? s.activeClass
                            : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/30"
                        }`}
                        aria-pressed={active}
                      >
                        <Icon className="size-3" />
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {state?.error ? (
        <p className="text-chart-4 bg-chart-4/10 border-chart-4/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
          <AlertCircle className="size-4" />
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t pt-5">
        <span className="text-muted-foreground text-xs">
          {dirty ? "변경됨" : "변경 사항 없음"}
        </span>
        <SubmitButton />
      </div>
    </form>
  );
}
