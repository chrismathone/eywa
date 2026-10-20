"use client";

import type { GradeSplit, GradeSplitRow } from "@/features/students/enrollment/enrolled-composition";
import { DASHBOARD_SUBJECT_COLORS } from "@/features/dashboard/overview/subject-colors";
import { Legend, number } from "./charts";
import { SubjectBarPopover } from "./subject-bar-popover";
import s from "./overview.module.css";

/**
 * 학년별 재원생 — 한 줄 = 한 학년, 막대 하나를 영어만 · 영어+수학 · 수학만 세 조각으로(원장 2026-09-11).
 * 색은 대시보드 전체의 과목 기준과 같다: 영어만 = 빨강 · 영어+수학 = 보라 · 수학만 = 파랑.
 * 막대 안엔 색만 두고, 누르면 수강 구성별 인원을 작은 팝업으로 보여준다.
 * 줄 **오른쪽**엔 그 줄의 합계를 적는다(원장 2026-09-12 "학년별 재원생 우측에 인원수 표시") — 급별(level-split)과 같은 자리.
 * 보라 합계 = '동시 수강'. 마지막 회색 막대는 실제 미수강이며, 그 외 과목만 수강하는 학생과 구분한다.
 */
export const STUDENT_SEGMENTS = [
  { key: "englishOnly", label: "영어만", color: DASHBOARD_SUBJECT_COLORS.english },
  { key: "both", label: "영어+수학", color: DASHBOARD_SUBJECT_COLORS.both },
  { key: "mathOnly", label: "수학만", color: DASHBOARD_SUBJECT_COLORS.math },
] as const;

const rowTotal = (row: GradeSplitRow) => row.englishOnly + row.both + row.mathOnly;

export function GradeSplitChart({ split, noEnrollment = split.neither }: { split: GradeSplit; noEnrollment?: number }) {
  // 영어·수학 수강생이 한 명도 없는 학년은 줄을 세우지 않는다(빈 막대가 줄을 늘릴 뿐이다).
  const rows = split.rows.filter((row) => rowTotal(row) > 0);
  const otherOnly = Math.max(0, split.neither - noEnrollment);
  const max = Math.max(1, noEnrollment, otherOnly, ...rows.map(rowTotal));
  return (
    <>
        <div className={s.gradeSplit}>
          {rows.map((row) => (
            <div key={row.label} className={s.gradeRow}>
              <span className={s.barLabel}>{row.label}</span>
              <SubjectBarPopover label={row.label} items={STUDENT_SEGMENTS.map((seg) => ({ ...seg, label: seg.key === "both" ? "동시수강" : seg.label, value: row[seg.key] }))}>
              <span className={s.gradeTrack}>
                <span className={s.gradeBar} style={{ width: `${(rowTotal(row) / max) * 100}%` }}>
                  {STUDENT_SEGMENTS.map((seg) =>
                    row[seg.key] > 0 ? (
                      <i
                        key={seg.key}
                        role="img"
                        aria-label={`${row.label} ${seg.label} ${number(row[seg.key])}명`}
                        title={`${number(row[seg.key])}명`}
                        style={{ flexGrow: row[seg.key], background: seg.color }}
                      />
                    ) : null,
                  )}
                </span>
              </span>
              </SubjectBarPopover>
              <span className={s.gradeCount}>{number(rowTotal(row))}<small>명</small></span>
            </div>
          ))}
          {[...(otherOnly > 0 ? [{ label: "기타 과목", value: otherOnly, color: DASHBOARD_SUBJECT_COLORS.other }] : []), { label: "미수강", value: noEnrollment, color: DASHBOARD_SUBJECT_COLORS.unenrolled }].map((row) => <div className={s.gradeRow} key={row.label}>
            <span className={s.barLabel}>{row.label}</span>
            <span className={s.gradeTrack}>
              <i className={s.unenrolledBar} role="img" aria-label={`${row.label} 재원생 ${number(row.value)}명`} title={`${number(row.value)}명`} style={{ width: `${row.value / max * 100}%`, background: row.color }} />
            </span>
            <span className={s.gradeCount}>{number(row.value)}<small>명</small></span>
          </div>)}
        </div>
      <Legend items={STUDENT_SEGMENTS.map(({ key, label, color }) => ({ label: key === "both" ? "동시수강" : label, color }))} />
    </>
  );
}
