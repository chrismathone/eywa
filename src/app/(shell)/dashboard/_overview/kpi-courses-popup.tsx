"use client";

import { Fragment } from "react";
import type { OverviewData } from "@/features/dashboard/overview/model";
import { COURSE_BUCKETS, type CourseCombo } from "@/features/students/enrollment/course-count";
import { number } from "./charts";
import { CountList, PopupEmpty, PopupTotal } from "./kpi-popup-parts";
import s from "./overview.module.css";

/** 학생별 중복 없는 과목 수와 과목 조합. 카드·팝업·통계가 같은 기준을 쓴다. */
export function CoursesPopup({
  data,
  subjectLabels,
}: {
  data: OverviewData["courses"] | null | undefined;
  subjectLabels: Record<string, string>;
}) {
  if (!data) return <PopupEmpty>강좌수 정보를 불러오지 못했습니다.</PopupEmpty>;
  if (data.basis !== "student-subject") return <PopupEmpty>화면을 새로고침해 주세요.</PopupEmpty>;
  const partLabel = (key: string) => subjectLabels[key] ?? "기타 과목";
  return (
    <>
      <PopupTotal label="강좌수" value={data.total} unit="개" />
      <p className={s.footnote}>수업 듣는 학생 {number(data.students)}명 · 학생마다 같은 과목은 한 번만 셉니다.</p>
      <CountList unit="개" rows={Object.entries(data.subjects).map(([key, value]) => ({ key, label: partLabel(key), value }))} />
      <p className={s.popupSummary}>학생당 강좌 수 — 무엇으로 듣는지</p>
      {data.combos ? <ComboTable data={data} partLabel={partLabel} /> : null}
      <p className={s.footnote}>
        학생마다 과목별로 한 번만 셉니다. 수학 반을 다섯 개와 영어·국어를 들으면 3개입니다. 수학 일반·심화는 수학,
        EiE·인재원 영어는 영어로 묶습니다. 휴원·시작 전·과목 미입력 수강은 제외하고, 종료일이 적힌 수강은 그날까지 셉니다.
        칸마다 조합 인원을 더하면 그 칸의 학생 수입니다.
      </p>
    </>
  );
}

function ComboTable({ data, partLabel }: { data: NonNullable<OverviewData["courses"]>; partLabel: (p: CourseCombo["parts"][number]["subject"]) => string }) {
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
                  <tr key={c.parts.map((p) => `${p.subject}${p.count}`).join("+")} className="border-line-faint border-t">
                    <td className={`${cell} pl-5`}>{c.parts.map((p) => `${partLabel(p.subject)} ${p.count}`).join(" + ")}</td>
                    <td className={`${cell} text-right`}>{number(c.students)}명</td>
                  </tr>
                ))}
            </Fragment>
          ))}
      </tbody>
    </table>
  );
}
