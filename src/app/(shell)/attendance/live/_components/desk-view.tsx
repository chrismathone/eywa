"use client";

/**
 * 데스크 확인 큐 — 과목별로 쪼갠 뒤 결석 → 미입력 반 → 미확인.
 * 처리한 건은 지우지 않고 아래로(#105).
 */
import type { ReactNode } from "react";
import { CheckCircle2 } from "@/components/icons/eywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { OUTCOME_LABEL, orderQueueSubjects, type DeskQueue } from "@/features/attendance/live/queue";
import { DeskClassRow } from "./desk-class-row";
import { DeskStudentRow } from "./desk-student-row";

export function DeskView({
  queue,
  date,
  canEdit,
  carryOver,
}: {
  queue: DeskQueue;
  date: string;
  canEdit: boolean;
  carryOver: { date: string; count: number } | null;
}) {
  const subjects = useSubjectMaps();
  const empty = queue.counts.classes === 0 && queue.counts.students === 0;
  const absentRows = queue.lanes.students.filter((s) => s.signal === "absent");
  const unmarkedRows = queue.lanes.students.filter((s) => s.signal !== "absent");
  const keys = orderQueueSubjects(
    [
      ...queue.lanes.classes.map((c) => c.subject),
      ...queue.lanes.students.map((s) => s.subject),
      ...queue.done.map((s) => s.subject),
    ],
    subjects.options.map((o) => o.value),
  );

  return (
    <div className="space-y-6">
      {carryOver && carryOver.count > 0 && (
        <a
          href={`/attendance/live?tab=desk&date=${carryOver.date}`}
          className="text-amber-strong text-sm font-bold"
        >
          어제 남은 결석 {carryOver.count}건
        </a>
      )}
      {empty && queue.counts.done === 0 && (
        <EmptyState
          icon={CheckCircle2}
          title="확인할 건이 없습니다"
          description="수업 시작 10분이 지나도 출결이 비어 있으면 여기에 뜹니다."
        />
      )}

      {keys.map((subject) => {
        const classes = queue.lanes.classes.filter((c) => c.subject === subject);
        const absent = absentRows.filter((s) => s.subject === subject);
        const unmarked = unmarkedRows.filter((s) => s.subject === subject);
        const done = queue.done.filter((s) => s.subject === subject);
        if (classes.length + absent.length + unmarked.length + done.length === 0) return null;
        return (
          <section key={subject || "none"} className="space-y-4">
            <h2 className="text-lg font-bold">{subjects.labelOf(subject) || "과목 없음"}</h2>
            {absent.length > 0 && (
              <Lane title="결석" count={absent.length} danger>
                {absent.map((s) => (
                  <DeskStudentRow
                    key={`${s.studentId}@${s.classId}@${s.slotStart}`}
                    row={s}
                    date={date}
                    canEdit={canEdit}
                  />
                ))}
              </Lane>
            )}
            {classes.length > 0 && (
              <Lane title="미입력 반" count={classes.length}>
                {classes.map((c) => (
                  <DeskClassRow
                    key={`${c.classId}@${c.slotStart}`}
                    row={c}
                    date={date}
                    canEdit={canEdit}
                  />
                ))}
              </Lane>
            )}
            {unmarked.length > 0 && (
              <Lane title="미확인" count={unmarked.length}>
                {unmarked.map((s) => (
                  <DeskStudentRow
                    key={`${s.studentId}@${s.classId}@${s.slotStart}`}
                    row={s}
                    date={date}
                    canEdit={canEdit}
                  />
                ))}
              </Lane>
            )}
            {done.length > 0 && (
              <Lane title="처리함" count={done.length}>
                {done.map((s) => (
                  <div
                    key={`${s.studentId}@${s.classId}@${s.slotStart}`}
                    className="text-text-dim flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-sm"
                  >
                    <span className="text-text font-bold">{s.studentName}</span>
                    <span className="num text-xs">
                      {s.className} · {s.slotStart}
                    </span>
                    <span className="ml-auto text-xs">
                      {s.followup?.state === "dismissed"
                        ? "해당 없음"
                        : s.followup?.outcome
                          ? (OUTCOME_LABEL[s.followup.outcome] ?? "확인")
                          : "확인"}
                    </span>
                    {s.followup?.handledByName && (
                      <span className="text-text-faint text-xs">{s.followup.handledByName}</span>
                    )}
                  </div>
                ))}
              </Lane>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Lane({
  title,
  count,
  danger,
  children,
}: {
  title: string;
  count: number;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-baseline gap-2">
        <span className="text-sm font-bold">{title}</span>
        <span className={`num text-sm ${danger ? "text-att-absent-ink" : "text-text-dim"}`}>{count}</span>
      </h3>
      <div className="bg-card shadow-card divide-line divide-y rounded-2xl">{children}</div>
    </section>
  );
}
