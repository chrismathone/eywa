"use client";

import { metricOf } from "@/features/teacher-portfolio/model/types";
import { dayLabel, pointsText, recordMonthNames } from "@/features/teacher-portfolio/view";
import type { EvidenceProps } from "./evidence-records";
import { StudentCell } from "./evidence-records";
import { DataTable, SectionTitle, StatTiles, StatusChip } from "./parts";

/**
 * 퇴원율 내역 — 분모(지난달 절반 이상 맡은 학생)·분자(이 달에 그만둔 학생)와 그만둔 학생마다 포함했는지·제외한 까닭.
 * 제외한 까닭: 원장이 고른 사유 · 반 이동 · 수업이 끝남 · 끝난 특강 · 같은 과목 다른 반(어느 선생님 반이든) · 수강종료를 세지 않음 · 같은 학생.
 */
export function ChurnEvidence({ period, nameOf }: EvidenceProps) {
  const m = metricOf(period, "churn");
  const rate = m.raw === null || m.raw === undefined ? "—" : `${m.raw.toFixed(1)}%`;
  // 달 이름으로 적는다 — 10월 점수 화면은 9월 퇴원 ÷ 8월 담당(점수 달의 재료 = 지난달).
  const names = recordMonthNames(period);
  return (
    <>
      <StatTiles items={[
        { label: `${names.prev} 담당`, value: `${m.base}명` }, { label: "그만둔 학생", value: `${m.counted}명`, className: m.counted ? "text-amber" : undefined },
        { label: "퇴원율", value: rate }, { label: "점수", value: pointsText(m, period) },
      ]} />
      <p className="bg-primary-softer mt-4 rounded-lg px-3.5 py-3 text-xs leading-relaxed">
        {names.prev}에 이 선생님이 {m.need}일 이상 맡은 학생만 분모에 넣습니다(한두 번 맡은 학생은 넣지 않습니다).
      </p>
      <SectionTitle sub={`${m.detail.length}건`}>{names.cur}에 그만둔 학생</SectionTitle>
      <DataTable headers={["학생 · 반", "날짜", "구분", "사유", "퇴원율"]} kinds={["text", "num", "num", "text", "num"]}
        empty={`${names.prev} 담당 학생 중 ${names.cur}에 그만둔 학생이 없습니다.`}
        rows={m.detail.map((r, i) => ({
          key: `${r.studentId}|${r.day}|${i}`,
          cells: [
            <StudentCell key="s" name={nameOf(r.studentId)} sub={r.className} />, dayLabel(r.day), r.type, r.reason,
            <span key="c" className="inline-flex flex-col items-center gap-0.5">
              <StatusChip state={r.counted ? "포함" : "제외"} />
              {r.note ? <small className="text-xs">{r.note}</small> : null}
            </span>,
          ],
        }))} />
    </>
  );
}
