"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Loader2,
  Pencil,
  RotateCcw,
  Save,
  X,
} from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  saveAttendance,
  type SaveAttendanceState,
} from "@/features/attendance/server/actions";
import type {
  AttendanceInputRow,
  AttendanceStatus,
} from "@/features/attendance/server/queries";
import { formatSessionUnits } from "@/features/attendance/session-units";

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
    activeClass: "text-primary bg-primary/10 border-primary/30",
  },
  {
    value: "absent",
    label: "결석",
    icon: X,
    activeClass: "text-danger bg-danger/10 border-danger/30",
  },
  {
    value: "late",
    label: "지각",
    icon: Clock,
    activeClass: "text-amber bg-amber/10 border-amber/30",
  },
  {
    value: "early_leave",
    label: "조퇴",
    icon: Clock,
    activeClass: "text-rose bg-rose/10 border-rose/30",
  },
  {
    value: "makeup",
    label: "보강",
    icon: RotateCcw,
    activeClass: "text-purple bg-purple/10 border-purple/30",
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

type CellState = {
  status: AttendanceStatus | null;
  note: string;
  homeworkRequired: boolean;
  homeworkDone: boolean;
  // 시수(정규 1회 기준 배수) raw 입력 — ""=기본 1. 서버(parseSessionUnits)에서 검증.
  units: string;
  expanded: boolean;
};

function unitsToDraft(sessionUnits: number | null): string {
  return sessionUnits === null || sessionUnits === 1 ? "" : formatSessionUnits(sessionUnits);
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
  const [pending, setPending] = useState<Record<string, CellState>>(() => {
    const init: Record<string, CellState> = {};
    for (const r of rows) {
      const units = unitsToDraft(r.sessionUnits);
      init[r.studentId] = {
        status: r.status,
        note: r.note ?? "",
        homeworkRequired: r.homeworkRequired,
        homeworkDone: r.homeworkDone,
        units,
        expanded: !!(r.note || r.homeworkRequired || units),
      };
    }
    return init;
  });

  function patchOne(studentId: string, patch: Partial<CellState>) {
    setPending((p) => ({ ...p, [studentId]: { ...p[studentId], ...patch } }));
  }

  function setOne(studentId: string, status: AttendanceStatus | null) {
    patchOne(studentId, { status });
  }

  function setAll(status: AttendanceStatus) {
    setPending((p) => {
      const next = { ...p };
      for (const r of rows) next[r.studentId] = { ...next[r.studentId], status };
      return next;
    });
  }

  function clearAll() {
    setPending((p) => {
      const next = { ...p };
      for (const r of rows) {
        next[r.studentId] = {
          ...next[r.studentId],
          status: null,
          note: "",
          homeworkRequired: false,
          homeworkDone: false,
          units: "",
        };
      }
      return next;
    });
  }

  const dirty = rows.some((r) => {
    const c = pending[r.studentId];
    return (
      c.status !== r.status ||
      c.note !== (r.note ?? "") ||
      c.homeworkRequired !== r.homeworkRequired ||
      c.homeworkDone !== r.homeworkDone ||
      c.units !== unitsToDraft(r.sessionUnits)
    );
  });
  const filled = rows.filter((r) => pending[r.studentId].status != null).length;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="classId" value={classId} />
      <input type="hidden" name="date" value={date} />

      {/* Bulk actions */}
      <div className="border-line bg-card flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-2.5">
        <div className="text-text-dim text-xs">
          입력 {filled} / {rows.length}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAll("present")}
            className="text-primary hover:bg-primary/10 rounded-lg px-2 py-1 text-xs font-medium transition"
          >
            전체 출석
          </button>
          <span className="text-text-dim/40 text-xs">·</span>
          <button
            type="button"
            onClick={clearAll}
            className="text-text-dim hover:text-foreground rounded-lg px-2 py-1 text-xs transition"
          >
            전체 초기화
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="border-line bg-bg-soft/20 rounded-2xl border border-dashed p-8 text-center">
          <p className="text-text-dim text-sm">이 날짜에 활성 재원생이 없습니다.</p>
        </div>
      ) : (
        <ul className="bg-card border-line divide-border divide-y rounded-2xl border">
          {rows.map((r) => {
            const cell = pending[r.studentId];
            const hasExtra = !!(cell.note || cell.homeworkRequired);
            return (
              <li key={r.studentId} className="px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/students/${r.studentId}`}
                      target="_blank"
                      className="text-foreground text-sm font-medium hover:underline inline-flex items-center gap-1"
                      title={`${r.studentName} 학생 상세로 이동 (새 탭)`}
                    >
                      {r.studentName}
                      <ExternalLink className="text-text-dim size-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                    {r.studentGrade ? (
                      <span className="text-text-dim text-xs">{r.studentGrade}</span>
                    ) : null}
                    {r.existingRecordId ? (
                      <span className="text-text-dim text-[10px]">· 이전 기록 있음</span>
                    ) : null}
                    {hasExtra ? (
                      <span className="bg-purple/10 text-purple border-purple/20 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]">
                        {cell.note ? <Pencil className="size-2.5" /> : null}
                        {cell.homeworkRequired ? <BookOpen className="size-2.5" /> : null}
                        {cell.units ? <span className="num font-bold">{cell.units}</span> : null}
                      </span>
                    ) : null}
                  </div>

                  <input
                    type="hidden"
                    name={`existing:${r.studentId}`}
                    value={r.existingRecordId ?? ""}
                  />
                  {/* 서버 에러 메시지용 학생 이름(시수 검증 실패 시 누구인지 표시) */}
                  <input type="hidden" name={`name:${r.studentId}`} value={r.studentName} />
                  <input type="hidden" name={`units:${r.studentId}`} value={cell.units} />
                  <input
                    type="hidden"
                    name={`status:${r.studentId}`}
                    value={cell.status ?? ""}
                  />
                  <input
                    type="hidden"
                    name={`note:${r.studentId}`}
                    value={cell.note}
                  />
                  <input
                    type="hidden"
                    name={`homeworkRequired:${r.studentId}`}
                    value={cell.homeworkRequired ? "true" : "false"}
                  />
                  <input
                    type="hidden"
                    name={`homeworkDone:${r.studentId}`}
                    value={cell.homeworkDone ? "true" : "false"}
                  />

                  <div className="inline-flex flex-wrap items-center justify-end gap-1">
                    {STATUS_DEFS.map((s) => {
                      const Icon = s.icon;
                      const active = cell.status === s.value;
                      return (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() =>
                            setOne(r.studentId, active ? null : s.value)
                          }
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium transition ${
                            active
                              ? s.activeClass
                              : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft/30"
                          }`}
                          aria-pressed={active}
                        >
                          <Icon className="size-3" />
                          {s.label}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => patchOne(r.studentId, { expanded: !cell.expanded })}
                      className="text-text-dim hover:text-foreground ml-1 inline-flex size-6 items-center justify-center rounded-md"
                      aria-label={cell.expanded ? "접기" : "메모/숙제 펼치기"}
                    >
                      {cell.expanded ? (
                        <ChevronUp className="size-3" />
                      ) : (
                        <ChevronDown className="size-3" />
                      )}
                    </button>
                  </div>
                </div>

                {cell.expanded ? (
                  <div className="bg-bg-soft/30 border-line mt-2 space-y-2 rounded-md border p-2.5">
                    <div className="flex items-start gap-2">
                      <Pencil className="text-text-dim mt-1.5 size-3" />
                      <input
                        type="text"
                        value={cell.note}
                        onChange={(e) => patchOne(r.studentId, { note: e.target.value })}
                        placeholder="메모 (오늘의 특이사항 등)"
                        className="border-line bg-card text-foreground flex-1 rounded-md border px-2 py-1.5 text-xs"
                      />
                    </div>
                    {/* 시수(배수) — 정규 1회=1(빈 칸), 보강 연장 1.5·2, 부분 출석 0.5 */}
                    <label className="text-foreground flex items-center gap-2 text-xs">
                      <Clock className="text-text-dim size-3" />
                      시수
                      <input
                        type="text"
                        inputMode="decimal"
                        value={cell.units}
                        onChange={(e) => patchOne(r.studentId, { units: e.target.value })}
                        placeholder="1"
                        title="정규 수업 1회 = 1 (빈 칸). 보강 연장 1.5·2, 부분 출석 0.5 등"
                        className="border-line bg-card text-foreground w-16 rounded-md border px-2 py-1.5 text-xs"
                      />
                      <span className="text-text-dim">회분 (빈 칸 = 1)</span>
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-foreground inline-flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={cell.homeworkRequired}
                          onChange={(e) =>
                            patchOne(r.studentId, { homeworkRequired: e.target.checked })
                          }
                        />
                        <BookOpen className="text-text-dim size-3" />
                        숙제 부여
                      </label>
                      <label
                        className={`inline-flex items-center gap-1.5 text-xs ${cell.homeworkRequired ? "text-foreground" : "text-text-dim opacity-50"}`}
                      >
                        <input
                          type="checkbox"
                          checked={cell.homeworkDone}
                          onChange={(e) =>
                            patchOne(r.studentId, { homeworkDone: e.target.checked })
                          }
                          disabled={!cell.homeworkRequired}
                        />
                        숙제 완료
                      </label>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {state?.error ? (
        <p className="text-danger bg-danger/10 border-danger/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
          <AlertCircle className="size-4" />
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t pt-5">
        <span className="text-text-dim text-xs">
          {dirty ? "변경됨" : "변경 사항 없음"}
        </span>
        <SubmitButton />
      </div>
    </form>
  );
}
