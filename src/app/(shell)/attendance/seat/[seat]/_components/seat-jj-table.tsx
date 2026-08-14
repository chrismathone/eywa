"use client";

import { schoolGradeLabel } from "@/lib/format/school-grade";
import {
  isJjMarkField,
  JJ_MARK_MAXLEN,
  jjClassColumns,
  jjSeatTextCols,
  type JjMarkField,
} from "@/features/attendance/seat/jj-fields";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import type { SeatStatus } from "@/features/attendance/seat/server/actions";
import { SEAT_LABEL, SEAT_TONE } from "./seat-status";

const INPUT =
  "border-line focus:border-primary h-8 w-full rounded-lg border bg-card px-2 text-[13px] font-semibold outline-none disabled:opacity-60";

type JjTableProps = {
  rosters: SeatClassRoster[];
  statusOf: (classId: string, student: SeatClassRoster["students"][number]) => SeatStatus | null;
  onSave: (classId: string, studentId: string, next: SeatStatus | null, prev: SeatStatus | null) => void;
  onSaveField: (classId: string, studentId: string, field: JjMarkField, value: string) => void;
  onFillClass: (classId: string) => void;
  readOnly: boolean;
  pending: boolean;
};

/**
 * JJ실 출석부 — 반은 **가로**, 학생은 반 안에서 **세로**.
 * 전폭 표로 쌓으면 이름 칸이 창을 밀어 가로가 비고 반은 아래로만 길어진다.
 */
export function SeatJjTable(props: JjTableProps) {
  return (
    <div
      className="grid items-start gap-3 overflow-x-auto"
      style={{ gridTemplateColumns: jjClassColumns(props.rosters.length) }}
    >
      {props.rosters.map((r) => (
        <SeatJjClass
          key={r.classId}
          roster={r}
          statusOf={props.statusOf}
          onSave={props.onSave}
          onSaveField={props.onSaveField}
          onFillClass={props.onFillClass}
          readOnly={props.readOnly}
          pending={props.pending}
        />
      ))}
    </div>
  );
}

function SeatJjClass({
  roster: r,
  statusOf,
  onSave,
  onSaveField,
  onFillClass,
  readOnly,
  pending,
}: Omit<JjTableProps, "rosters"> & { roster: SeatClassRoster }) {
  const cols = jjSeatTextCols();
  const left = r.students.filter((s) => statusOf(r.classId, s) === null).length;
  return (
    <section className="border-line min-w-0 overflow-hidden rounded-2xl border">
      <header className="bg-bg-soft border-line flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-[13px]">
        <span className="min-w-0 truncate font-bold" title={r.className}>
          {r.className}
        </span>
        <span className="text-text-faint text-[11px] tabular-nums">{r.students.length}명</span>
        <span className="text-text-faint text-[11px] tabular-nums">~{r.end}</span>
        {!readOnly && left > 0 ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => onFillClass(r.classId)}
            className="border-line bg-card text-primary ml-auto rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold disabled:opacity-50"
          >
            이 반 출석
          </button>
        ) : null}
      </header>
      <table className="w-full table-fixed border-collapse text-[13px] [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-[var(--line-faint)]">
        <colgroup>
          <col style={{ width: "28%" }} />
          <col style={{ width: "20%" }} />
          {cols.map((c) => (
            <col key={c.field} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-bg-soft text-foreground text-[11px]">
            <th className="px-2 py-1.5 text-center font-bold">이름</th>
            <th className="px-1 py-1.5 text-center font-bold">출결</th>
            {cols.map((c) => (
              <th key={c.field} className="px-1 py-1.5 text-center leading-tight font-bold" title={c.title}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {r.students.map((s) => {
            const cur = statusOf(r.classId, s);
            return (
              <tr key={s.id}>
                <td className="px-2 py-1.5">
                  <p className="truncate font-bold" title={s.name}>
                    {s.name}
                  </p>
                  <p className="text-text-dim truncate text-[11.5px]">
                    {schoolGradeLabel(s.school, s.grade) || " "}
                  </p>
                </td>
                <td className="px-1 py-1.5">
                  <div className="flex flex-wrap items-center justify-center gap-1">
                    <button
                      type="button"
                      disabled={readOnly || pending}
                      onClick={() => onSave(r.classId, s.id, cur === "present" ? null : "present", cur)}
                      className={`min-w-[40px] rounded-lg border px-1.5 py-1 text-[12px] font-bold disabled:cursor-default ${
                        cur ? SEAT_TONE[cur] : "border-line bg-card border-dashed text-text-dim"
                      }`}
                    >
                      {cur ? SEAT_LABEL[cur] : "출석"}
                    </button>
                    {!readOnly && cur !== "absent" ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onSave(r.classId, s.id, "absent", cur)}
                        aria-label={`${s.name} 결석`}
                        className="border-line bg-card text-text-faint hover:text-att-absent-ink grid size-6 place-items-center rounded-full border text-[10px] font-bold"
                      >
                        결
                      </button>
                    ) : null}
                  </div>
                </td>
                {cols.map((c) => {
                  const field = c.field;
                  if (!isJjMarkField(field)) return null;
                  return (
                    <td key={field} className="px-1 py-1.5">
                      <input
                        className={INPUT}
                        value={s[field] ?? ""}
                        disabled={readOnly}
                        maxLength={JJ_MARK_MAXLEN}
                        aria-label={`${s.name} ${c.label}`}
                        title={c.title}
                        onChange={(e) => onSaveField(r.classId, s.id, field, e.target.value)}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
