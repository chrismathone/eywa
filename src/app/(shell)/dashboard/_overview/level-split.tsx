"use client";

import type { LevelSubjectSplit } from "@/features/dashboard/overview/student-composition";
import { DASHBOARD_SUBJECT_COLORS } from "@/features/dashboard/overview/subject-colors";
import { Legend, number } from "./charts";
import { STUDENT_SEGMENTS } from "./grade-split";
import { SubjectBarPopover } from "./subject-bar-popover";
import s from "./overview.module.css";

export function LevelSplitChart({ split, noEnrollment }: { split: LevelSubjectSplit; noEnrollment: number }) {
  const count = (row: LevelSubjectSplit["rows"][number]) => row.englishOnly + row.both + row.mathOnly;
  const otherOnly = Math.max(0, split.rows.reduce((sum, row) => sum + row.neither, 0) - noEnrollment);
  const max = Math.max(1, noEnrollment, otherOnly, ...split.rows.map(count));
  const total = split.rows.reduce((sum, row) => sum + row.total, 0);
  return <>
    <div className={s.levelTotal}><span>전체 재원생</span><strong>{number(total)}<small>명</small></strong></div>
    <div className={s.levelSplit}>
      {split.rows.map((row) => <div className={s.levelRow} key={row.label}>
        <b>{row.label}</b>
        <SubjectBarPopover label={row.label} items={STUDENT_SEGMENTS.map((part) => ({ ...part, label: part.key === "both" ? "동시수강" : part.label, value: row[part.key] }))}>
        <span className={s.levelTrack}>
          <span className={s.gradeBar} style={{ width: `${count(row) / max * 100}%` }}>
            {STUDENT_SEGMENTS.map((part) => row[part.key] > 0 ? <i key={part.key} role="img" aria-label={`${row.label} ${part.label} ${number(row[part.key])}명`} title={`${part.label} ${number(row[part.key])}명`} style={{ flexGrow: row[part.key], background: part.color }} /> : null)}
          </span>
        </span>
        </SubjectBarPopover>
        <span className={s.levelCount}>{number(count(row))}<small>명</small></span>
      </div>)}
      {[...(otherOnly > 0 ? [{ label: "기타 과목", value: otherOnly, color: DASHBOARD_SUBJECT_COLORS.other }] : []), { label: "미수강", value: noEnrollment, color: DASHBOARD_SUBJECT_COLORS.unenrolled }].map((row) => <div className={s.levelRow} key={row.label}>
        <b>{row.label}</b><span className={s.levelTrack}><i className={s.unenrolledBar} role="img" aria-label={`${row.label} 재원생 ${number(row.value)}명`} title={`${number(row.value)}명`} style={{ width: `${row.value / max * 100}%`, background: row.color }} /></span><span className={s.levelCount}>{number(row.value)}<small>명</small></span>
      </div>)}
    </div>
    <Legend items={STUDENT_SEGMENTS.map((part) => ({ label: part.key === "both" ? "동시수강" : part.label, color: part.color }))} />
  </>;
}
