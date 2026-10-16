"use client";

import { reportGroups, reportMark, weekdayOf } from "@/features/teacher-portfolio/evidence-view";
import { metricOf } from "@/features/teacher-portfolio/model/types";
import { dayLabel } from "@/features/teacher-portfolio/view";
import type { EvidenceProps } from "./evidence-records";
import { StudentCell } from "./evidence-records";
import { DataTable, SectionTitle } from "./parts";

/**
 * 보고서 학생 × 날짜 상태표 — 상세 창에서만 연다. 반별로 나눈다(원장 2026-10-16 *"반별 분리해서 이름 학교 학년"*) —
 * 열 = 그 반에 보고 대상이 있던 날만(대상이 아닌 칸은 비운다 · 원장 2026-10-14) · 칸 = 작성 O / 미작성 빗금(*"O / O랑 슬러시"*).
 * 반마다 표가 짧아서 가로 스크롤 막대가 표 바로 아래에 온다(원장 *"스크롤이 하단에 고정되어있어서 불편함"*).
 */
export function ReportMatrix({ period, nameOf, schoolOf }: Pick<EvidenceProps, "period" | "nameOf" | "schoolOf">) {
  const groups = reportGroups(metricOf(period, "report").detail, nameOf);
  if (!groups.length) return <p className="py-6 text-center text-xs">이 달 보고 대상이 없습니다.</p>;
  return (
    <>
      {groups.map((g) => (
        <section key={g.className} className="mt-5 first:mt-0">
          <SectionTitle sub={`${g.students.length}명${g.missing ? ` · 미작성 ${g.missing}건` : ""}`}>{g.className}</SectionTitle>
          <div className="overflow-x-auto px-px">
            <DataTable
              headers={["학생", ...g.days.map((d) => <span key={d}>{dayLabel(d)}<small className="block text-xs font-medium">{weekdayOf(d)}</small></span>)]}
              rows={g.students.map((id) => ({
                key: id,
                cells: [
                  <span key="s" className="block whitespace-nowrap"><StudentCell name={nameOf(id)} school={schoolOf?.(id)} /></span>,
                  ...g.days.map((d) => {
                    const state = g.cells.get(`${id}|${d}`);
                    if (!state) return "";
                    const r = reportMark(state);
                    return <span key={d} role="img" aria-label={r.label} className={`text-sm font-bold ${r.done ? "text-primary" : "text-amber"}`}>{r.mark}</span>;
                  }),
                ],
              }))} />
          </div>
        </section>
      ))}
      <p className="mt-3 text-xs">O = 작성 · / = 미작성 · 빈 칸 = 그날 그 학생은 보고 대상이 아닙니다.</p>
    </>
  );
}
