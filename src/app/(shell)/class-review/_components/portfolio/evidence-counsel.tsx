"use client";

import { useState } from "react";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { dayWeekLabel } from "@/features/teacher-portfolio/evidence-view";
import { metricOf } from "@/features/teacher-portfolio/model/types";
import { pointsText } from "@/features/teacher-portfolio/view";
import { StudentCell, type EvidenceProps } from "./evidence-records";
import { DataTable, StatTiles } from "./parts";

/**
 * 원생상담 내역 — 이 달 담임 반 학생마다 본인이 상담했는지(원장 2026-10-14 *"내 모든학생을 전부다 이번달에 전부다 1회 이상 상담하면
 * 만점"* · *"비율에 따라 점수 계산"* · *"부담임은 상담 안해도 됨"*). 목록은 '상담 완료 / 상담 미완료' 두 탭(원장 2026-10-16) —
 * 처음엔 할 일이 남은 '미완료'가 열린다.
 */
export function CounselEvidence({ period, nameOf, schoolOf }: EvidenceProps) {
  const m = metricOf(period, "counsel");
  const rate = m.raw === null || m.raw === undefined ? "—" : `${m.raw.toFixed(1)}%`;
  const done = m.detail.filter((r) => r.consulted), todo = m.detail.filter((r) => !r.consulted);
  const [picked, setPicked] = useState<"done" | "todo" | null>(null);
  const tab = picked ?? (todo.length ? "todo" : "done");
  const student = (r: (typeof m.detail)[number]) => (
    <StudentCell key="s" name={nameOf(r.studentId)} school={schoolOf?.(r.studentId)} sub={r.className || "—"} />
  );
  return (
    <>
      <StatTiles items={[
        { label: "담임 반 학생", value: `${m.total}명` },
        { label: "상담한 학생", value: `${m.consulted}명`, className: "text-primary" },
        { label: "상담 비율", value: rate },
        { label: "점수", value: pointsText(m, period) },
      ]} />
      <div className="mt-5 mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold">담임 반 학생</h4>
        <ToolbarSegment>
          <ToolbarSegmentItem active={tab === "done"} onClick={() => setPicked("done")}>상담 완료 {done.length}</ToolbarSegmentItem>
          <ToolbarSegmentItem active={tab === "todo"} onClick={() => setPicked("todo")}>상담 미완료 {todo.length}</ToolbarSegmentItem>
        </ToolbarSegment>
      </div>
      {tab === "done" ? (
        <DataTable headers={["학생 · 반", "처음 상담한 날"]} kinds={["text", "num"]}
          empty={m.detail.length ? "아직 상담한 학생이 없습니다." : "이 달 담임인 반이 없습니다(부담임으로만 맡은 반은 세지 않습니다)."}
          rows={done.map((r) => ({ key: r.studentId, cells: [student(r), r.day ? dayWeekLabel(r.day) : "—"] }))} />
      ) : (
        <DataTable headers={["학생 · 반"]} kinds={["text"]}
          empty={m.detail.length ? "모든 학생을 상담했습니다." : "이 달 담임인 반이 없습니다(부담임으로만 맡은 반은 세지 않습니다)."}
          rows={todo.map((r) => ({ key: r.studentId, cells: [student(r)] }))} />
      )}
      <p className="mt-3 text-xs leading-relaxed">{m.reason}</p>
    </>
  );
}
