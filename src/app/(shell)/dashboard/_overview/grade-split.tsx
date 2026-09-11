"use client";

import type { GradeSplit, GradeSplitRow } from "@/features/students/enrolled-composition";
import { Legend, number } from "./charts";
import s from "./overview.module.css";

/**
 * 학년별 재원생 — 한 줄 = 한 학년, 막대 하나를 영어만 · 영어+수학 · 수학만 세 조각으로(원장 2026-09-11).
 * 🔴 색은 과목 색이 아니라 **원장 명시 예외**다: 영어만 = 빨강 · 영어+수학 = 보라 · 수학만 = 파랑.
 * 막대 위엔 글자를 두지 않는다(색만) — 인원은 마우스를 올리면 `12명`, 스크린리더는 aria-label.
 * 보라 합계 = '동시 수강'(같은 subjectMixOf 판정) · 각주의 '모두 없음'까지 더하면 재원생과 맞는다.
 */
const SEGMENTS = [
  { key: "englishOnly", label: "영어만", color: "var(--danger)" },
  { key: "both", label: "영어+수학", color: "var(--purple)" },
  { key: "mathOnly", label: "수학만", color: "var(--blue)" },
] as const;

const rowTotal = (row: GradeSplitRow) => row.englishOnly + row.both + row.mathOnly;

export function GradeSplitChart({ split }: { split: GradeSplit }) {
  // 영어·수학 수강생이 한 명도 없는 학년은 줄을 세우지 않는다(빈 막대가 줄을 늘릴 뿐이다).
  const rows = split.rows.filter((row) => rowTotal(row) > 0);
  const max = Math.max(1, ...rows.map(rowTotal));
  const counted = rows.reduce((sum, row) => sum + rowTotal(row), 0);
  return (
    <>
      {rows.length === 0 ? (
        <p className={s.empty}>영어·수학을 수강하는 재원생이 없습니다.</p>
      ) : (
        <div className={s.gradeSplit}>
          {rows.map((row) => (
            <div key={row.label} className={s.gradeRow}>
              <span className={s.barLabel}>{row.label}</span>
              <span className={s.gradeTrack}>
                <span className={s.gradeBar} style={{ width: `${(rowTotal(row) / max) * 100}%` }}>
                  {SEGMENTS.map((seg) =>
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
            </div>
          ))}
        </div>
      )}
      <Legend items={SEGMENTS.map(({ label, color }) => ({ label, color }))} />
      <p className={s.footnote}>
        영어·수학 모두 없는 재원생 {number(split.neither)}명 · 합계 {number(counted + split.neither)}명
      </p>
    </>
  );
}
