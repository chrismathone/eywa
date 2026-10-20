"use client";

import { Fragment } from "react";
import type { OverviewData } from "@/features/dashboard/overview/model";
import { COURSE_BUCKETS, type CourseCombo } from "@/features/students/enrollment/course-count";
import { PROGRAMS, programLabel, visiblePrograms, type ProgramSubject } from "@/features/students/enrollment/program";
import { dashboardProgramColor } from "@/features/dashboard/overview/subject-colors";
import { number } from "./charts";
import { CountList, PopupEmpty, PopupTotal } from "./kpi-popup-parts";
import s from "./overview.module.css";

/**
 * '강좌수' 팝업(원장 2026-10-20) — 프로그램별 강좌수 + **강좌 수마다 무엇으로 듣는지**(원장 같은 날 *"2개를 어떤걸로 듣는지 전혀 모르잖아"*):
 * 1개 · 2개 · 3개 · 4개 이상 칸마다 학생 수와 그 안의 과목 조합(수학 2 · 수학 1 + 인재원 영어 1 …)별 인원. 조합 인원을 더하면 그 칸의 학생 수 —
 * 처음엔 프로그램을 칸으로 세운 표였는데 줄을 가로로 더하게 읽혀 합이 안 맞아 보였다(*"전체가 181인데 왜 다 더하면 181이 아니지?"*).
 * 숫자는 카드와 같은 `courses` 영역 값(`summarizeCourses`). 세 프로그램 밖 과목의 반은 '그 외 과목'.
 */
export function CoursesPopup({
  data,
  subjects,
  eieOn = true,
}: {
  data: OverviewData["courses"] | null | undefined;
  subjects: ProgramSubject[];
  /** EiE 구분을 쓰는 학원인가(스냅샷 `eie`) — 재원생 팝업과 같은 규약. */
  eieOn?: boolean;
}) {
  if (!data) return <PopupEmpty>강좌수 정보를 불러오지 못했습니다.</PopupEmpty>;
  const other = data.total - PROGRAMS.reduce((n, p) => n + data.programs[p], 0);
  const partLabel = (p: CourseCombo["parts"][number]["program"]) => (p === "other" ? "그 외 과목" : programLabel(p, subjects, eieOn));
  return (
    <>
      <PopupTotal label="강좌수" value={data.total} unit="개" />
      <CountList
        unit="개"
        rows={[
          ...visiblePrograms(eieOn).map((program) => ({
            key: program,
            label: programLabel(program, subjects, eieOn),
            value: data.programs[program],
            color: dashboardProgramColor(program),
          })),
          ...(other > 0 ? [{ key: "other", label: "그 외 과목", value: other }] : []),
        ]}
      />
      <p className={s.popupSummary}>학생당 강좌 수 — 무엇으로 듣는지</p>
      {data.combos ? <ComboTable data={data} partLabel={partLabel} /> : null}
      <p className={s.footnote}>
        한 학생이 듣는 반을 모두 셉니다(같은 과목 반이 둘이면 2개) — 휴원 중이거나 아직 시작하지 않은 수강은 빼고, 종료일이 적힌 수강은 그날까지
        셉니다. 칸마다 조합 인원을 더하면 그 칸의 학생 수입니다.
      </p>
    </>
  );
}

function ComboTable({ data, partLabel }: { data: NonNullable<OverviewData["courses"]>; partLabel: (p: CourseCombo["parts"][number]["program"]) => string }) {
  const cell = "px-2 py-1.5";
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-line text-muted-foreground border-b text-xs">
          <th className={`${cell} text-left font-medium`}>강좌 수 · 과목 조합</th>
          <th className={`${cell} text-right font-medium`}>학생</th>
        </tr>
      </thead>
      <tbody className="num">
        {data.perStudent
          .filter((b) => b.students > 0)
          .map((b) => (
            <Fragment key={b.courses}>
              <tr className="border-line border-t bg-bg-soft/40 font-bold">
                <td className={cell}>{b.courses >= COURSE_BUCKETS ? `${b.courses}개 이상` : `${b.courses}개`}</td>
                <td className={`${cell} text-right`}>{number(b.students)}명</td>
              </tr>
              {data.combos
                .filter((c) => c.bucket === b.courses)
                .map((c) => (
                  <tr key={c.parts.map((p) => `${p.program}${p.count}`).join("+")} className="border-line-faint border-t">
                    <td className={`${cell} pl-5`}>{c.parts.map((p) => `${partLabel(p.program)} ${p.count}`).join(" + ")}</td>
                    <td className={`${cell} text-right`}>{number(c.students)}명</td>
                  </tr>
                ))}
            </Fragment>
          ))}
      </tbody>
    </table>
  );
}
