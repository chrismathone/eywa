"use client";

import { Button } from "@/components/ui/button";
import { dayWeekLabel } from "@/features/teacher-portfolio/evidence-view";
import { metricOf } from "@/features/teacher-portfolio/model/types";
import { pointsText } from "@/features/teacher-portfolio/view";
import { GradesEvidence } from "./evidence-grades";
import type { EvidenceProps } from "./evidence-records";
import { DataTable, SectionTitle, StatTiles, StatusChip } from "./parts";

/**
 * 계산이 들어온 원장 구성 지표 셋의 내역 — 성적 관리 · 학부모 만족도 · 강사 근태(원장 2026-10-15 *"계산 안된거 다음 단계라고 적힌거 다 해결해"*).
 * 숫자가 어떻게 나왔는지(종류별 평균과 비중 · 반영한 글과 클레임 · 센 날과 뺀 날)를 그대로 보인다.
 */
function SatisfactionEvidence({ period, nameOf, schoolOf, onSatisfaction }: EvidenceProps) {
  const m = metricOf(period, "satisfaction");
  const sign = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
  return (
    <>
      <StatTiles items={[
        { label: "가점 글", value: `${m.plus ?? 0}건` }, { label: "감점 글", value: `${m.minus ?? 0}건` },
        { label: "클레임·칭찬", value: `${m.claims ?? 0}건` }, { label: "점수", value: pointsText(m, period) },
      ]} />
      {/* 확인 대기는 여기서 바로 만족도 관리로 이어 간다(원장 2026-10-16 *"여기서도 만족도관리 이어질 수 있게"*). */}
      {m.waiting || onSatisfaction ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {m.waiting ? <span>확인 대기 {m.waiting}건 — 반영하기 전엔 점수에 들지 않습니다.</span> : null}
          {onSatisfaction ? <Button type="button" size="sm" variant="outline" onClick={onSatisfaction}>만족도 관리</Button> : null}
        </p>
      ) : null}
      <SectionTitle sub={`${m.detail.length}건`}>글 판정 · 클레임</SectionTitle>
      <DataTable headers={["날짜", "학생", "학교학년", "반", "근거", "판정", "점수"]} kinds={["num", "text", "text", "text", "text", "text", "num"]}
        empty="이 달 반영한 학부모 글·클레임이 없습니다."
        rows={m.detail.map((r) => ({
          key: r.key,
          cells: [dayWeekLabel(r.day), r.studentId ? nameOf(r.studentId) : "—", (r.studentId && schoolOf?.(r.studentId)) || "—", r.className || "—",
            r.text ? `${r.source === "글" ? "“" : ""}${r.text}${r.source === "글" ? "”" : ""}` : "—",
            <StatusChip key="h" state={r.how} />, r.points === null ? "—" : sign(r.points)],
        }))} />
      <p className="mt-3 text-xs leading-relaxed">{m.reason}</p>
    </>
  );
}

const STATUS = { late: "지각", absent: "결근", early: "조퇴", recorded: "기록으로 출근" } as const;
const BASIS = { personal: "개인 시각", lessons: "수업" } as const;
const clock = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }) : "—");
function PunctualityEvidence({ period }: EvidenceProps) {
  const m = metricOf(period, "punctuality");
  // 프리랜서 = 근태를 세지 않고 만점(원장 2026-10-16 *"프리랜서 라벨 붙이고 부연설명"*).
  if (m.freelancer) return (
    <>
      <StatTiles items={[{ label: "계약구분", value: "프리랜서", className: "text-primary" }, { label: "점수", value: pointsText(m, period) }]} />
      <p className="bg-primary-softer mt-4 rounded-lg px-3.5 py-3 text-xs leading-relaxed">{m.reason}</p>
    </>
  );
  return (
    <>
      <StatTiles items={[
        // 출근·퇴근 기록 = 그 달 시각이 찍힌 날 수(원장 2026-10-15) — 이 칸이 생기기 전에 저장(마감)된 달엔 없다(—).
        { label: "출근 기록", value: m.checkIns === undefined ? "—" : `${m.checkIns}일` }, { label: "퇴근 기록", value: m.checkOuts === undefined ? "—" : `${m.checkOuts}일` },
        { label: "지각", value: `${m.late ?? 0}회` }, { label: "결근", value: `${m.absent ?? 0}회` }, { label: "조퇴", value: `${m.early ?? 0}회` },
        { label: "제외한 날(결재된 휴가)", value: `${m.excused ?? 0}일` }, { label: "점수", value: pointsText(m, period) },
      ]} />
      <SectionTitle sub={m.manual ? "원장 직접 입력이 이 달 수치입니다" : `출퇴근 기록 ${m.days ?? 0}일 · 기준 = 그날 맡은 수업(또는 개인 출퇴근 시각)`}>지각·결근·조퇴한 날</SectionTitle>
      <DataTable headers={["날짜", "구분", "기준", "출근", "퇴근", "차이", "반영"]} kinds={["num", "text", "num", "num", "num", "num", "text"]}
        empty={m.days ? "이 달 지각·결근·조퇴가 없습니다." : "이 달 출퇴근 기록이 없습니다."}
        rows={m.detail.map((r) => {
          const minutes = r.minutes ?? r.lateMinutes ?? null;
          return {
            key: `${r.day}|${r.status}`,
            cells: [dayWeekLabel(r.day), STATUS[r.status] ?? r.status, r.expected ? `${r.expected}${r.basis ? ` (${BASIS[r.basis]})` : ""}` : "—",
              clock(r.checkIn), clock(r.checkOut), minutes ? `${minutes}분` : "—",
              <StatusChip key="c" state={r.counted ? "포함" : `제외 · ${r.excuse}`} />],
          };
        })} />
      <p className="mt-3 text-xs leading-relaxed">{m.reason}</p>
    </>
  );
}

/** 내역 분기(`evidence-impact.tsx`)가 부른다 — 계산 전 자리는 그쪽이 안내 카드로 먼저 거른다. */
export function SourceEvidence({ id, ...props }: EvidenceProps & { id: "grades" | "satisfaction" | "punctuality" }) {
  return id === "grades" ? <GradesEvidence {...props} /> : id === "satisfaction" ? <SatisfactionEvidence {...props} /> : <PunctualityEvidence {...props} />;
}
