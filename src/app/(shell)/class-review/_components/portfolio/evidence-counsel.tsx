"use client";

import { metricOf } from "@/features/teacher-portfolio/model/types";
import { dayLabel, pointsText } from "@/features/teacher-portfolio/view";
import { StudentCell, type EvidenceProps } from "./evidence-records";
import { DataTable, SectionTitle, StatTiles, StatusChip } from "./parts";

/**
 * 원생상담 내역 — 이 달 담당 학생마다 본인이 상담했는지(원장 2026-10-14 *"내 모든학생을 전부다 이번달에 전부다 1회 이상 상담하면
 * 만점"* · *"비율에 따라 점수 계산"*). 아직 상담하지 않은 학생이 위에 선다.
 */
export function CounselEvidence({ period, nameOf }: EvidenceProps) {
  const m = metricOf(period, "counsel");
  const rate = m.raw === null || m.raw === undefined ? "—" : `${m.raw.toFixed(1)}%`;
  return (
    <>
      <StatTiles items={[
        { label: "담당 학생", value: `${m.total}명` },
        { label: "상담한 학생", value: `${m.consulted}명`, className: "text-primary" },
        { label: "상담 비율", value: rate },
        { label: "점수", value: pointsText(m, period) },
      ]} />
      <SectionTitle sub={`미상담 ${m.total - m.consulted}명`}>담당 학생</SectionTitle>
      <DataTable headers={["학생 · 반", "처음 상담한 날", "상담"]} kinds={["text", "num", "num"]}
        empty="이 달 담당 학생이 없습니다."
        rows={m.detail.map((r) => ({
          key: r.studentId,
          cells: [
            <StudentCell key="s" name={nameOf(r.studentId)} sub={r.className || "—"} />,
            r.day ? dayLabel(r.day) : "—",
            <StatusChip key="c" state={r.consulted ? "상담함" : "미상담"} />,
          ],
        }))} />
      <p className="mt-3 text-xs leading-relaxed">{m.reason}</p>
    </>
  );
}
