"use client";

import { schoolGradeLabel } from "@/lib/format/school-grade";
import {
  isJjMarkField,
  JJ_MARK_MAXLEN,
  jjSeatTextCols,
  type JjMarkField,
} from "@/features/attendance/seat/jj-fields";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import type { SeatStatus } from "@/features/attendance/seat/server/actions";
import { SEAT_LABEL, SEAT_TONE } from "./seat-status";

const INPUT =
  "border-line focus:border-primary h-8 w-full rounded-lg border bg-card px-2 text-[13px] font-semibold outline-none disabled:opacity-60";

/**
 * JJ실 출석부 — 랩실과 같은 출결 + 듣기 레벨·누적 암기 단어수.
 * 칸 라벨은 `jjSeatTextCols`(ECS JJ 폼과 동일). 저장은 그 시트와 같은 행.
 */
export function SeatJjTable({
  rosters,
  statusOf,
  onSave,
  onSaveField,
  onFillClass,
  readOnly,
  pending,
}: {
  rosters: SeatClassRoster[];
  statusOf: (classId: string, student: SeatClassRoster["students"][number]) => SeatStatus | null;
  onSave: (classId: string, studentId: string, next: SeatStatus | null, prev: SeatStatus | null) => void;
  onSaveField: (classId: string, studentId: string, field: JjMarkField, value: string) => void;
  onFillClass: (classId: string) => void;
  readOnly: boolean;
  pending: boolean;
}) {
  const cols = jjSeatTextCols();
  return (
    <>
      {rosters.map((r) => {
        const left = r.students.filter((s) => statusOf(r.classId, s) === null).length;
        return (
          <section key={r.classId} className="border-line overflow-hidden rounded-2xl border">
            <header className="bg-bg-soft border-line flex items-center gap-2 border-b px-3 py-1.5 text-[13px]">
              <span className="font-bold">{r.className}</span>
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-[13px] [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-[var(--line-faint)]">
                <colgroup>
                  <col />
                  <col style={{ width: 88 }} />
                  {cols.map((c) => (
                    <col key={c.field} style={{ width: Math.max(c.width + 48, 112) }} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="bg-bg-soft text-foreground text-[11px]">
                    <th className="px-3 py-1.5 text-center font-bold">이름</th>
                    <th className="px-2 py-1.5 text-center font-bold">출결</th>
                    {cols.map((c) => (
                      <th key={c.field} className="px-2 py-1.5 text-center font-bold" title={c.title}>
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
                        <td className="px-3 py-1.5">
                          <p className="font-bold">{s.name}</p>
                          <p className="text-text-dim text-[11.5px]">{schoolGradeLabel(s.school, s.grade) || " "}</p>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              disabled={readOnly || pending}
                              onClick={() => onSave(r.classId, s.id, cur === "present" ? null : "present", cur)}
                              className={`min-w-[44px] rounded-lg border px-2 py-1 text-[12px] font-bold disabled:cursor-default ${
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
                            <td key={field} className="px-2 py-1.5">
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
            </div>
          </section>
        );
      })}
    </>
  );
}
