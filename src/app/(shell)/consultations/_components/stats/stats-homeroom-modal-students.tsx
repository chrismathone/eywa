"use client";

import { useState } from "react";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { WindowLink } from "@/components/workspace/window-link";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { HOMEROOM_CELL_META, type HomeroomCell, type HomeroomTeacher } from "@/features/consultations/homeroom-model";
import { bucketLabel } from "@/features/consultations/stats-model";

const mLabel = (ym: string) => bucketLabel(`${ym}-01`, "month");
const LEGEND: HomeroomCell[] = ["self", "other", "none", "before"];
type Show = "all" | "none" | "done";

/**
 * 상세 모달의 학생 표 — 표 보기의 펼친 표(stats-homeroom-students.tsx)와 같은 칸이지만 모달 폭을 다 쓰고,
 * 머리 줄이 스크롤에 붙고, 이번 달에 누가(담임 아닌 직원) 상담했는지를 칸으로 적는다(원장 2026-11-02 *"인원도 디자인 개판"*).
 */
export function ModalStudentTable({ t, months }: { t: HomeroomTeacher; months: string[] }) {
  const [show, setShow] = useState<Show>("all");
  const last = months.length - 1;
  const unmet = t.students.filter((s) => s.cells[last] === "none");
  const done = t.students.filter((s) => s.cells[last] === "self" || s.cells[last] === "other");
  const rows = show === "none" ? unmet : show === "done" ? done : t.students;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToolbarSegment label="학생">
          <ToolbarSegmentItem active={show === "all"} onClick={() => setShow("all")}>
            전체 {t.students.length}
          </ToolbarSegmentItem>
          <ToolbarSegmentItem active={show === "none"} onClick={() => setShow("none")}>
            이번 달 미상담 {unmet.length}
          </ToolbarSegmentItem>
          <ToolbarSegmentItem active={show === "done"} onClick={() => setShow("done")}>
            이번 달 상담 {done.length}
          </ToolbarSegmentItem>
        </ToolbarSegment>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {LEGEND.map((c) => (
            <span key={c} className="text-muted-foreground inline-flex items-center gap-1">
              <span className={`inline-flex size-4 items-center justify-center rounded ${TONE_SOFT[HOMEROOM_CELL_META[c].tone]}`}>{HOMEROOM_CELL_META[c].mark}</span>
              {HOMEROOM_CELL_META[c].label}
            </span>
          ))}
        </p>
      </div>
      <div className="border-line overflow-x-auto rounded-xl border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-bg-soft text-muted-foreground text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium">학생</th>
              {months.map((m, i) => (
                <th key={m} className="w-20 px-2 py-2 text-center font-medium whitespace-nowrap">
                  {i === last ? `${mLabel(m)}(진행 중)` : mLabel(m)}
                </th>
              ))}
              <th className="w-28 px-2 py-2 text-center font-medium whitespace-nowrap">마지막 담임 상담</th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">이번 달 담임 아닌 상담</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={months.length + 3} className="text-muted-foreground px-3 py-4 text-center text-xs">
                  해당하는 학생이 없습니다
                </td>
              </tr>
            ) : null}
            {rows.map((s) => (
              <tr key={s.id} className="border-line hover:bg-bg-soft/60 border-t">
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <WindowLink href={`/students/${s.id}`} className="text-foreground font-medium hover:underline">
                    {s.name}
                  </WindowLink>
                  {s.grade ? <span className="text-muted-foreground ml-1.5 text-xs">{s.grade}</span> : null}
                </td>
                {s.cells.map((c, i) => {
                  const meta = HOMEROOM_CELL_META[c];
                  const n = s.selfCounts[i] ?? 0;
                  const others = s.otherNames[i] ?? [];
                  const tip = [`${mLabel(months[i]!)} · ${meta.label}${n > 1 ? ` ${n}건` : ""}`, others.length ? `담임 아닌 상담: ${others.join(", ")}` : ""];
                  return (
                    <td key={i} className="px-2 py-1.5 text-center">
                      <span
                        title={tip.filter(Boolean).join("\n")}
                        className={`inline-flex h-6 min-w-9 items-center justify-center rounded-md px-1.5 text-xs ${TONE_SOFT[meta.tone]}`}
                      >
                        {meta.mark}
                        {n > 1 ? <span className="num ml-0.5">{n}</span> : null}
                      </span>
                    </td>
                  );
                })}
                <td className="num text-muted-foreground px-2 py-1.5 text-center text-xs">
                  {s.lastSelf ? `${Number(s.lastSelf.slice(5, 7))}/${Number(s.lastSelf.slice(8, 10))}` : "—"}
                </td>
                <td className="text-muted-foreground px-3 py-1.5 text-xs break-keep">{(s.otherNames[last] ?? []).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
