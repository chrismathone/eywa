"use client";

import { useSubjectMaps } from "@/features/owner/operations-context";
import { dayWeekLabel } from "@/features/teacher-portfolio/evidence-view";
import { metricOf } from "@/features/teacher-portfolio/model/types";
import { pointsText } from "@/features/teacher-portfolio/view";
import { StudentCell, type EvidenceProps } from "./evidence-records";
import { DataTable, SectionTitle, StatTiles } from "./parts";

/**
 * 원생 소개 내역 — 이 달에 인정된 소개 한 건씩(원장 결정 7). 소개받은 사람은 상담에 적힌 이름, 소개한 사람은 이은 원생(또는 직원 본인).
 */
export function ReferralEvidence({ period, nameOf, schoolOf }: EvidenceProps) {
  const m = metricOf(period, "expansion");
  const subjects = useSubjectMaps();
  const subjectText = (s: string | null) => (s ? s.split(",").map((k) => subjects.labelOf(k.trim())).filter(Boolean).join("·") : "—");
  return (
    <>
      <StatTiles items={[{ label: "인정된 소개", value: `${m.detail.length}건` }, { label: "점수", value: pointsText(m, period) }]} />
      <SectionTitle sub={`${m.detail.length}건`}>이 달에 인정된 소개</SectionTitle>
      <DataTable headers={["소개받은 학생", "상담일", "소개한 사람", "상담 과목"]} kinds={["text", "num", "text", "text"]}
        empty="이 달에 인정된 소개가 없습니다. 신규 콜&상담에서 '소개한 사람'을 원생·직원으로 이으면 셉니다."
        rows={m.detail.map((r) => ({
          key: r.consultationId,
          cells: [
            <StudentCell key="p" name={r.prospect || "—"} sub="상담 이름" />, dayWeekLabel(r.day),
            r.byStaff ? "본인(직원 소개)" : r.referrerStudentId ? <StudentCell key="r" name={nameOf(r.referrerStudentId)} school={schoolOf?.(r.referrerStudentId)} /> : "—", subjectText(r.subject),
          ],
        }))} />
      <p className="mt-3 text-xs leading-relaxed">{m.reason}</p>
    </>
  );
}
