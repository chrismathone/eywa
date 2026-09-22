"use client";

import { useMemo, useState } from "react";
import type { LearningRecord } from "@/features/math-sheets/lib/learning-plan";
import { learningBlockLabel } from "@/features/math-sheets/lib/learning-label";
import { TEST_KIND_LABEL, testCountLabel, testScoresOf, type TestScoreSource } from "@/features/math-sheets/lib/test-score";
import styles from "./linked-learning-map.module.css";

export function LearningReportList({ records, grade, period, scores, onSelect, open = false }: {
  records: LearningRecord[];
  grade?: string;
  period?: { from: string; to: string; label: string };
  scores?: Record<string, TestScoreSource>;
  onSelect?: (record: LearningRecord) => void;
  open?: boolean;
}) {
  const [scope, setScope] = useState<"period" | "all">("period");
  const sorted = useMemo(() => [...records].sort((a, b) => b.date.localeCompare(a.date) || (b.sentAt ?? "").localeCompare(a.sentAt ?? "")), [records]);
  const inPeriod = period ? sorted.filter(record => record.date >= period.from && record.date <= period.to) : sorted;
  const shown = period && scope === "period" ? inPeriod : sorted;
  return <details className={styles.records} open={open}>
    <summary>발송 수업보고서 전체 {records.length}건</summary>
    {period ? <div className={styles.controls}>
      <button aria-pressed={scope === "period"} onClick={() => setScope("period")}>선택 기간 {inPeriod.length}건</button>
      <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>전체 {records.length}건 보기</button>
      <span>{period.label} · {period.from === period.to ? period.from : `${period.from} – ${period.to}`}</span>
    </div> : null}
    {shown.length ? shown.map((record, index) => <article key={`${record.date}:${index}`}>
      {onSelect ? <button onClick={() => { setScope("period"); onSelect(record); }}><time>{record.date}</time></button> : <time>{record.date}</time>}
      <strong>{record.progress ? learningBlockLabel(record.progress, grade) : "진도 입력 없음"}</strong>
      {record.textbook ? <p>{record.textbook}</p> : null}
      {record.homework ? <p>과제: {record.homework}</p> : null}
      {scores?.[record.date] ? <p>{testScoresOf(scores[record.date]).map(score => `${TEST_KIND_LABEL[score.kind]} ${testCountLabel(score)}`).join(" · ")}</p> : null}
    </article>) : <p>{records.length ? "선택한 기간에 발송된 수업보고서가 없습니다. 전체 보기에서 이전 보고서를 확인하세요." : "기준일까지 이 반에서 발송된 수업보고서가 없습니다."}</p>}
  </details>;
}
