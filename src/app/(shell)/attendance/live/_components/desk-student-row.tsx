"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordFollowup } from "@/features/attendance/live/server/actions";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import { FOLLOWUP_OUTCOMES, suggestedStatus, type QueueStudent } from "@/features/attendance/live/queue";
import { SIGNAL_HINT, SIGNAL_LABEL } from "@/features/attendance/live/signals";
import { ABSENCE_REASON_LABEL, classifyAbsenceReason } from "@/features/attendance/absence-reason";
import { DeskCall } from "./desk-call";

export function DeskStudentRow({
  row,
  date,
  canEdit,
}: {
  row: QueueStudent;
  date: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const suggestion = outcome ? suggestedStatus(outcome) : null;
  const [applyStatus, setApplyStatus] = useState(true);
  const absent = row.signal === "absent";
  // 강사 메모에서 읽은 사유(여행·병결·학교 일정) — **표시일 뿐**이고 줄은 큐에 그대로 남는다([[#105]]).
  const reason = classifyAbsenceReason(row.note);

  function submit(state: "resolved" | "dismissed") {
    setError(null);
    startTransition(() => {
      recordFollowup({
        studentId: row.studentId,
        classId: row.classId,
        sessionDate: date,
        slotStart: row.saveSlot,
        signal: absent ? "absent" : "unmarked",
        state,
        outcome: outcome || null,
        note: note || null,
        contactedVia: null,
      })
        .then(async (res) => {
          if ("error" in res) return setError(res.error);
          if (state === "resolved" && suggestion && applyStatus) {
            // 전화 확인 후 정정은 미출결 게이트 밖(#103). source:live를 붙이면
            // 이미 결석인 칸을 '이미 옴'으로 못 되돌린다.
            const applied = await setAttendanceCell({
              studentId: row.studentId,
              classId: row.classId,
              sessionDate: date,
              status: suggestion,
              slotStart: row.saveSlot,
              periodStart: row.slotStart,
              quiet: true,
            }).catch(() => ({ error: "출결 정정에 실패했습니다" }) as const);
            if ("error" in applied) {
              setError(`확인은 저장했지만 출결 정정에 실패했습니다 — ${applied.error}`);
              router.refresh();
              return;
            }
          }
          setOpen(false);
          router.refresh();
        })
        .catch(() => setError("저장하지 못했습니다 — 다시 시도해 주세요"));
    });
  }

  return (
    <div className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-bold">{row.studentName}</span>
        {row.schoolGrade && <span className="text-text-faint text-xs">{row.schoolGrade}</span>}
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-bold ${
            absent ? "bg-att-absent text-att-absent-ink" : "bg-att-late text-att-late-ink"
          }`}
          title={SIGNAL_HINT[row.signal]}
        >
          {SIGNAL_LABEL[row.signal]}
        </span>
        {reason !== "unknown" && (
          <span
            className="bg-bg-soft text-text-dim rounded-full px-2 py-0.5 text-xs font-bold"
            title={`강사 메모에서 사유를 읽었습니다 — 아래 메모가 근거입니다. 목록에서 빠지지는 않고 같은 신호 안에서 뒤로 갑니다.`}
          >
            {ABSENCE_REASON_LABEL[reason]}
          </span>
        )}
        {row.teacherRequested && (
          <span
            className="bg-amber/15 text-amber rounded-full px-2 py-0.5 text-xs font-bold"
            title="강사가 이 교시 미입력 학생의 등원 확인을 데스크에 요청했습니다"
          >
            강사 확인 요청
          </span>
        )}
        <span className="text-text-dim num ml-auto text-xs">
          {row.className} · {row.slotStart}
          {row.teacherName ? ` · ${row.teacherName}` : ""}
        </span>
      </div>
      {row.note && <p className="text-text-dim mt-1 truncate text-xs">강사 메모 · {row.note}</p>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <DeskCall phone={row.parentPhone} label="학부모" />
        {row.studentPhone && <DeskCall phone={row.studentPhone} label="학생" />}
        {row.followup?.state === "open" && <span className="text-text-faint text-xs">확인 중</span>}
        {canEdit && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-primary ml-auto text-xs font-bold"
          >
            {open ? "접기" : "기록"}
          </button>
        )}
      </div>
      {open && canEdit && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1">
            {FOLLOWUP_OUTCOMES.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setOutcome(o.value)}
                aria-pressed={outcome === o.value}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  outcome === o.value ? "bg-primary text-primary-foreground" : "bg-bg-soft text-text-dim"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="메모 (선택)"
            className="border-line w-full rounded-lg border px-2.5 py-1.5 text-sm"
          />
          {suggestion && (
            <label className="text-text-dim flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={applyStatus} onChange={(e) => setApplyStatus(e.target.checked)} />
              출결을 {suggestion === "present" ? "출석" : "결석"}으로
            </label>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || !outcome}
              onClick={() => submit("resolved")}
              className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50"
            >
              저장
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => submit("dismissed")}
              className="text-text-faint text-xs font-bold"
            >
              해당 없음
            </button>
          </div>
          {error && <p className="text-danger text-xs">{error}</p>}
        </div>
      )}
    </div>
  );
}
