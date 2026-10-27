"use client";

import { WindowLink } from "@/components/workspace/window-link";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { HOMEROOM_CELL_META, type HomeroomTeacher } from "@/features/consultations/homeroom-model";
import { bucketLabel } from "@/features/consultations/stats-model";

const mLabel = (ym: string) => bucketLabel(`${ym}-01`, "month");

/** 칸 마우스 오버 — 무엇을 뜻하는지 + 담임이 아닌 직원이 했으면 **누가** 했는지(원장 *"다른 직원만 상담이 뭔말이여"*). */
function cellTitle(month: string, label: string, selfCount: number, others: string[]): string {
  const parts = [`${mLabel(month)} · ${label}${selfCount > 1 ? ` ${selfCount}건` : ""}`];
  if (others.length) parts.push(`담임 아닌 상담: ${others.join(", ")}`);
  return parts.join("\n");
}

/** 한 담임의 학생 × 달(homeroom-model.ts). 이번 달 미상담이 맨 위. */
export function HomeroomStudentGrid({ t, months, unmetOnly }: { t: HomeroomTeacher; months: string[]; unmetOnly: boolean }) {
  const last = months.length - 1;
  const rows = unmetOnly ? t.students.filter((s) => s.cells[last] === "none") : t.students;
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs break-keep">
        담임 반: {t.classNames.join(" · ")}
        {unmetOnly ? ` · 이번 달 미상담 학생만(${rows.length}/${t.students.length}명)` : ""}
      </p>
      <table className="border-collapse text-sm">
        <thead>
          <tr className="text-muted-foreground text-xs">
            <th className="px-2 py-1 text-center font-medium">학생</th>
            {months.map((m) => (
              <th key={m} className="w-14 px-1 py-1 text-center font-medium">
                {mLabel(m)}
              </th>
            ))}
            <th className="px-2 py-1 text-center font-medium whitespace-nowrap">마지막 담임 상담</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={months.length + 2} className="text-muted-foreground px-2 py-2 text-center text-xs">
                이번 달 미상담 학생이 없습니다
              </td>
            </tr>
          ) : null}
          {rows.map((s) => (
            <tr key={s.id} className="border-line border-t">
              <td className="px-2 py-1 whitespace-nowrap">
                <WindowLink href={`/students/${s.id}`} className="text-foreground font-medium hover:underline">
                  {s.name}
                </WindowLink>
                {s.grade ? <span className="text-muted-foreground ml-1 text-xs">{s.grade}</span> : null}
              </td>
              {s.cells.map((c, i) => {
                const meta = HOMEROOM_CELL_META[c];
                const n = s.selfCounts[i]!;
                return (
                  <td key={i} className="px-1 py-1 text-center">
                    <span
                      title={cellTitle(months[i]!, meta.label, n, s.otherNames[i] ?? [])}
                      className={`inline-flex h-6 min-w-8 items-center justify-center rounded px-1 text-xs ${TONE_SOFT[meta.tone]}`}
                    >
                      {meta.mark}
                      {n > 1 ? <span className="num ml-0.5">{n}</span> : null}
                    </span>
                  </td>
                );
              })}
              <td className="num text-muted-foreground px-2 py-1 text-center text-xs">
                {s.lastSelf ? `${Number(s.lastSelf.slice(5, 7))}/${Number(s.lastSelf.slice(8, 10))}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
