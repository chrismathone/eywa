"use client";

import { WindowLink } from "@/components/workspace/window-link";
import type { LevelSubjectSplit } from "@/features/dashboard/overview/student-composition";
import { DASHBOARD_SUBJECT_COLORS } from "@/features/dashboard/overview/subject-colors";
import { studentsCompositionHref, studentsUnenrolledHref } from "@/features/dashboard/overview/kpi-links";
import { levelKeyOfLabel } from "@/features/students/list-filter-values";
import { Legend, number } from "./charts";
import { STUDENT_SEGMENTS } from "./grade-split";
import { SubjectBarPopover } from "./subject-bar-popover";
import s from "./overview.module.css";

/**
 * 재원생 구성 — 학교급 줄마다 영어만 · 동시수강 · 수학만 조각 + 기타 과목 · 미수강 막대.
 *
 * 원장 2026-09-28 배선(정정본): *"'미수강' 막대그래프 누르면 이동하는걸로 나머지는 현재 그대로"* · 학교급 팝업은
 * *"이 안에서 누르면 이동하는걸로"* — 학교급 막대 = 누르면 '수강 구성' 팝업(종전) · 팝업의 줄 = 그 학교급 × 그 구성의
 * 원생목록 · '미수강' 막대 = 수강 과목 '미수강' 원생목록. 기타 과목 막대는 종전 그대로(링크 없음).
 * 🔴 **숫자 = 열린 목록 건수** — 목록은 막대와 같은 함수(compositionStudentIds · activeStudentIds)로 거른다(kpi-links.ts).
 */
export function LevelSplitChart({ split, noEnrollment }: { split: LevelSubjectSplit; noEnrollment: number }) {
  const count = (row: LevelSubjectSplit["rows"][number]) => row.englishOnly + row.both + row.mathOnly;
  const otherOnly = Math.max(0, split.rows.reduce((sum, row) => sum + row.neither, 0) - noEnrollment);
  const total = split.rows.reduce((sum, row) => sum + count(row), 0) + otherOnly + noEnrollment;
  const max = Math.max(1, ...split.rows.map(count), otherOnly, noEnrollment);
  const unenrolledHref = studentsUnenrolledHref();
  return <>
    <div className={s.levelTotal}><span>전체 재원생</span><strong>{number(total)}<small>명</small></strong></div>
    <div className={s.levelSplit}>
      {split.rows.map((row) => {
        // 모르는 줄 이름(옛 스냅샷 등)은 링크 없이 — 거를 수 없는 조건으로 목록을 열면 숫자가 어긋난다.
        const level = levelKeyOfLabel(row.label);
        return <div className={s.levelRow} key={row.label}>
          <b>{row.label}</b>
          <SubjectBarPopover label={row.label} items={STUDENT_SEGMENTS.map((part) => ({ ...part, label: part.key === "both" ? "동시수강" : part.label, value: row[part.key], href: level ? studentsCompositionHref({ level, mixes: [part.key] }) : null }))}>
          <span className={s.levelTrack}>
            <span className={s.gradeBar} style={{ width: `${count(row) / max * 100}%` }}>
              {STUDENT_SEGMENTS.map((part) => row[part.key] > 0 ? <i key={part.key} role="img" aria-label={`${row.label} ${part.label} ${number(row[part.key])}명`} title={`${part.label} ${number(row[part.key])}명`} style={{ flexGrow: row[part.key], background: part.color }} /> : null)}
            </span>
          </span>
          </SubjectBarPopover>
          <span className={s.levelCount}>{number(count(row))}<small>명</small></span>
        </div>;
      })}
      {otherOnly > 0 ? <div className={s.levelRow}>
        <b>기타 과목</b><span className={s.levelTrack}><i className={s.unenrolledBar} role="img" aria-label={`기타 과목 재원생 ${number(otherOnly)}명`} title={`${number(otherOnly)}명`} style={{ width: `${otherOnly / max * 100}%`, background: DASHBOARD_SUBJECT_COLORS.other }} /></span><span className={s.levelCount}>{number(otherOnly)}<small>명</small></span>
      </div> : null}
      <div className={s.levelRow}>
        <WindowLink href={unenrolledHref} className={s.barRowLink} ariaLabel={`미수강 재원생 ${number(noEnrollment)}명 원생목록 열기`}><b>미수강</b></WindowLink>
        <WindowLink href={unenrolledHref} className={s.levelTrack} ariaLabel={`미수강 재원생 ${number(noEnrollment)}명 원생목록 열기`}>
          <i className={`${s.unenrolledBar} ${s.barSegHover}`} title={`${number(noEnrollment)}명`} style={{ width: `${noEnrollment / max * 100}%`, background: DASHBOARD_SUBJECT_COLORS.unenrolled }} />
        </WindowLink>
        <WindowLink href={unenrolledHref} className={`${s.levelCount} ${s.barRowLink}`} ariaLabel={`미수강 재원생 ${number(noEnrollment)}명 원생목록 열기`}>{number(noEnrollment)}<small>명</small></WindowLink>
      </div>
    </div>
    <Legend items={STUDENT_SEGMENTS.map((part) => ({ label: part.key === "both" ? "동시수강" : part.label, color: part.color }))} />
  </>;
}
