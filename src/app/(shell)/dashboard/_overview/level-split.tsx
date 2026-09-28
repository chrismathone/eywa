"use client";

import { WindowLink } from "@/components/workspace/window-link";
import type { LevelSubjectSplit } from "@/features/dashboard/overview/student-composition";
import { DASHBOARD_SUBJECT_COLORS } from "@/features/dashboard/overview/subject-colors";
import { studentsCompositionHref, studentsUnenrolledHref } from "@/features/dashboard/overview/kpi-links";
import { levelKeyOfLabel, type StudentMixFilter } from "@/features/students/list-filter-values";
import { Legend, number } from "./charts";
import { STUDENT_SEGMENTS } from "./grade-split";
import s from "./overview.module.css";

/** 막대에 서는 세 조각 — 줄 전체 링크는 이 셋을 모두 싣는다(줄 오른쪽 숫자 = 셋의 합). */
const BAR_MIXES: readonly StudentMixFilter[] = STUDENT_SEGMENTS.map((part) => part.key);

/**
 * 재원생 구성 — 학교급 줄마다 영어만 · 동시수강 · 수학만 조각 + 기타 과목 · 미수강 막대.
 *
 * 원장 2026-09-28 *"막대를 클릭하면 그 조건으로 필터된 원생목록"* · *"다른 막대그래프들도 전부 해당기능으로 배선"*:
 * 조각 = 그 학교급 × 그 구성 · 줄 이름·숫자 = 그 학교급(세 조각 합) · 기타 과목 = mix=other · 미수강 = 수강 과목 '미수강'.
 * 🔴 **막대 숫자 = 열린 목록 건수** — 목록은 막대와 같은 함수(compositionStudentIds · activeStudentIds)로 거른다(kpi-links.ts).
 * 누르는 곳이 창을 여는 링크라 옛 '수강 구성' 팝업은 걷었다(인원은 마우스를 올리면 `title`로, 누르면 목록 건수로 보인다).
 */
export function LevelSplitChart({ split, noEnrollment }: { split: LevelSubjectSplit; noEnrollment: number }) {
  const count = (row: LevelSubjectSplit["rows"][number]) => row.englishOnly + row.both + row.mathOnly;
  const otherOnly = Math.max(0, split.rows.reduce((sum, row) => sum + row.neither, 0) - noEnrollment);
  const max = Math.max(1, noEnrollment, otherOnly, ...split.rows.map(count));
  const total = split.rows.reduce((sum, row) => sum + row.total, 0);
  return <>
    <div className={s.levelTotal}><span>전체 재원생</span><strong>{number(total)}<small>명</small></strong></div>
    <div className={s.levelSplit}>
      {split.rows.map((row) => {
        const level = levelKeyOfLabel(row.label);
        // 모르는 줄 이름(옛 스냅샷 등)은 링크 없이 그린다 — 거를 수 없는 조건으로 목록을 열면 숫자가 어긋난다.
        const rowHref = level ? studentsCompositionHref({ level, mixes: BAR_MIXES }) : null;
        return <div className={s.levelRow} key={row.label}>
          {rowHref
            ? <WindowLink href={rowHref} className={s.barRowLink} ariaLabel={`${row.label} 재원생 ${number(count(row))}명 원생목록 열기`}><b>{row.label}</b></WindowLink>
            : <b>{row.label}</b>}
          <span className={s.levelTrack}>
            <span className={s.gradeBar} style={{ width: `${count(row) / max * 100}%` }}>
              {STUDENT_SEGMENTS.map((part) => {
                if (row[part.key] <= 0) return null;
                const label = `${row.label} ${part.key === "both" ? "동시수강" : part.label} ${number(row[part.key])}명`;
                return <i key={part.key} style={{ flexGrow: row[part.key], background: part.color }}>
                  {level
                    ? <WindowLink href={studentsCompositionHref({ level, mixes: [part.key] })} className={s.barSegLink} title={label} ariaLabel={`${label} 원생목록 열기`} />
                    : null}
                </i>;
              })}
            </span>
          </span>
          {rowHref
            ? <WindowLink href={rowHref} className={`${s.levelCount} ${s.barRowLink}`} ariaLabel={`${row.label} 재원생 ${number(count(row))}명 원생목록 열기`}>{number(count(row))}<small>명</small></WindowLink>
            : <span className={s.levelCount}>{number(count(row))}<small>명</small></span>}
        </div>;
      })}
      {[
        ...(otherOnly > 0 ? [{ label: "기타 과목", value: otherOnly, color: DASHBOARD_SUBJECT_COLORS.other, href: studentsCompositionHref({ mixes: ["other"] }) }] : []),
        { label: "미수강", value: noEnrollment, color: DASHBOARD_SUBJECT_COLORS.unenrolled, href: studentsUnenrolledHref() },
      ].map((row) => <div className={s.levelRow} key={row.label}>
        <WindowLink href={row.href} className={s.barRowLink} ariaLabel={`${row.label} 재원생 ${number(row.value)}명 원생목록 열기`}><b>{row.label}</b></WindowLink>
        <span className={s.levelTrack}>
          <i className={s.unenrolledBar} style={{ width: `${row.value / max * 100}%`, background: row.color }}>
            <WindowLink href={row.href} className={s.barSegLink} title={`${number(row.value)}명`} ariaLabel={`${row.label} 재원생 ${number(row.value)}명 원생목록 열기`} />
          </i>
        </span>
        <WindowLink href={row.href} className={`${s.levelCount} ${s.barRowLink}`} ariaLabel={`${row.label} 재원생 ${number(row.value)}명 원생목록 열기`}>{number(row.value)}<small>명</small></WindowLink>
      </div>)}
    </div>
    <Legend items={STUDENT_SEGMENTS.map((part) => ({ label: part.key === "both" ? "동시수강" : part.label, color: part.color }))} />
  </>;
}
