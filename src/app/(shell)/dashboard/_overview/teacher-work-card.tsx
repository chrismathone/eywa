"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { TeacherWork, TeacherWorkRow } from "@/features/dashboard/overview/teacher-work";
import { WindowLink } from "@/components/workspace/window-link";
import { kstTimeOf } from "@/lib/date-kst";
import s from "./teacher-work-card.module.css";

export function workRatio(value: number, total: number) {
  return `${value.toLocaleString("ko-KR")} / ${total.toLocaleString("ko-KR")} (${total ? `${Math.round(value / total * 100)}%` : "—"})`;
}
const metrics: { key: string; label: string; total: "reportTarget" | "videoAssigned"; value: (r: TeacherWorkRow) => number; tone: "good" | "alert"; video?: boolean }[] = [
  { key: "written", label: "보고서 작성", total: "reportTarget", value: (r) => r.reports, tone: "good" },
  { key: "sent", label: "보고서 발송", total: "reportTarget", value: (r) => r.sent, tone: "good" },
  { key: "unsent", label: "보고서 미발송", total: "reportTarget", value: (r) => r.reportTarget - r.sent, tone: "alert" },
  { key: "unwritten", label: "보고서 미작성", total: "reportTarget", value: (r) => r.reportTarget - r.reports, tone: "alert" },
  { key: "failed", label: "발송 오류", total: "reportTarget", value: (r) => r.failed, tone: "alert" },
  { key: "submitted", label: "영상 제출", total: "videoAssigned", value: (r) => r.videoSubmitted, tone: "good", video: true },
  { key: "missing", label: "영상 미제출", total: "videoAssigned", value: (r) => r.videoMissing, tone: "alert", video: true },
];

/** 폭이 부족하면 강사 묶음을 아래로 이어 붙인다. 가로·세로 내부 스크롤 없이 모든 수치를 보여 준다. */
export function TeacherWorkCard({ data, subjects }: { data: TeacherWork; subjects: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(6);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setColumns(Math.max(1, Math.floor(((entry?.contentRect.width ?? 1000) - 126) / 148))));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const groups = Array.from({ length: Math.ceil(data.rows.length / columns) }, (_, n) => data.rows.slice(n * columns, (n + 1) * columns));
  return <div ref={ref} className={s.root} data-auto-height data-teacher-work>
    {groups.map((rows, i) => <table key={i} className={s.table}>
      <caption className="sr-only">강사별 업무 현황 {i + 1}</caption>
      <colgroup><col className={s.metricColumn} />{rows.map((r) => <col key={`${r.teacherId}:${r.subject}`} />)}</colgroup>
      <thead><tr><th scope="col">업무</th>{rows.map((r) => <th key={`${r.teacherId}:${r.subject}`} scope="col">
        <b>{r.teacherName}</b><small>{subjects[r.subject] ?? r.subject} · {r.classIds.length}반</small>
        {r.reportSource === "classnote" ? <small>반 알림장 기준</small> : null}
      </th>)}</tr></thead>
      <tbody>{metrics.map((metric) => <tr key={metric.key} data-video={metric.key === "submitted" || undefined}>
        <th scope="row">{metric.label}</th>{rows.map((r) => {
          const value = metric.value(r), total = r[metric.total];
          const label = workRatio(value, total);
          return <td key={`${r.teacherId}:${r.subject}`} data-tone={value ? metric.tone : undefined}>
            {metric.video && total ? <WindowLink href={`/lesson-reports/video-homework?${new URLSearchParams({ from: data.videoFrom, to: data.to, class: r.classIds.join(","), status: metric.key })}`}>{label}</WindowLink> : label}
          </td>;
        })}
      </tr>)}</tbody>
    </table>)}
    {!data.rows.length ? <p className={s.empty}>집계할 담당 반이 없습니다.</p> : null}
    <p className={s.note}>보고서: 작성할 전체 건수 기준 · 미작성 포함 · 결석·휴원·테스트반 제외. 영상: 배정한 숙제 중 실제 업로드 기준.</p>
    <p className={s.note}>{data.videoCheckedAt ? `영상 확인 ${kstTimeOf(data.videoCheckedAt)} 기준` : "영상 상태 확인 대기"} · 분모가 0이면 비율은 —로 표시합니다.</p>
  </div>;
}
