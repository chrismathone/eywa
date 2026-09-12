"use client";

import type { SubjectDistributionRow } from "@/features/dashboard/overview/student-composition";
import { DASHBOARD_SUBJECT_COLORS as COLORS } from "@/features/dashboard/overview/subject-colors";
import { Legend, number } from "./charts";
import { STUDENT_SEGMENTS } from "./grade-split";
import { SubjectBarPopover } from "./subject-bar-popover";
import s from "./overview.module.css";

const SEGMENTS = [
  ...STUDENT_SEGMENTS.map((segment) => ({ ...segment, label: segment.key === "both" ? "동시수강" : segment.label })),
  { key: "otherOnly", label: "기타 과목", color: COLORS.other },
  { key: "noEnrollment", label: "미수강", color: COLORS.unenrolled },
] as const;

export function StudentSubjectLegend({ rows }: { rows: SubjectDistributionRow[] }) {
  if (!rows.some((row) => row.subjects)) return null;
  return <Legend items={SEGMENTS.filter((segment, index) => index < 3 || rows.some((row) => (row.subjects?.[segment.key] ?? 0) > 0))} />;
}

export function StudentSubjectBars({ rows, max = Math.max(1, ...rows.map((row) => row.value)) }: {
  rows: SubjectDistributionRow[];
  max?: number;
}) {
  return <div className={s.bars}>
    {rows.map((row) => (
      <div className={s.barRow} key={row.label}>
        <span className={s.barLabel}>{row.label}</span>
        <SubjectBarPopover label={row.label} items={row.subjects && SEGMENTS
          .filter((segment, index) => index < 3 || row.subjects![segment.key] > 0)
          .map((segment) => ({ ...segment, value: row.subjects![segment.key] }))}>
        <span className={`${s.barTrack} ${s.subjectTrack}`}>
          <span className={s.gradeBar} style={{ width: `${row.value / Math.max(1, max) * 100}%` }}>
            {row.subjects ? SEGMENTS.map((segment) => {
              const value = row.subjects![segment.key];
              return value > 0 ? <i key={segment.key} role="img"
                aria-label={`${row.label} ${segment.label} ${number(value)}명`}
                title={`${row.label} · ${segment.label} ${number(value)}명`}
                style={{ flexGrow: value, background: segment.color }} /> : null;
            }) : <i role="img" aria-label={`${row.label} 전체 ${number(row.value)}명`}
              title="수강 구성 갱신 대기" style={{ flexGrow: 1, background: COLORS.other }} />}
          </span>
        </span>
        </SubjectBarPopover>
        <b>{number(row.value)}<small>명</small></b>
      </div>
    ))}
  </div>;
}
