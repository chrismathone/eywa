"use client";

import { KIND_LABEL } from "@/features/grades/unified/model";
import type { GradeKindStat } from "@/features/teacher-portfolio/model/source-types";
import { Button } from "@/components/ui/button";
import { metricOf } from "@/features/teacher-portfolio/model/types";
import { dayLabel, pointsText } from "@/features/teacher-portfolio/view";
import { StudentCell, type EvidenceProps } from "./evidence-records";
import { DataTable, SectionTitle, StatTiles, StatusChip } from "./parts";

/**
 * 계산이 들어온 원장 구성 지표 셋의 내역 — 성적 관리 · 학부모 만족도 · 강사 근태(원장 2026-10-15 *"계산 안된거 다음 단계라고 적힌거 다 해결해"*).
 * 숫자가 어떻게 나왔는지(종류별 평균과 비중 · 반영한 글과 클레임 · 센 날과 뺀 날)를 그대로 보인다.
 */
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);

/** 종류별 셈(원장 2026-10-15) — 이 칸이 생기기 전에 저장(마감)된 달은 전부 점수율이다. */
const MEASURE = { submit: "제출률", take: "응시율", score: "점수율" } as const;
const targetText = (k: GradeKindStat) => (k.measure === "submit" ? `${k.done ?? 0}/${k.count}칸` : k.measure === "take" ? `${k.done ?? 0}/${k.count}명` : `${k.count}건`);

function GradesEvidence({ period, nameOf }: EvidenceProps) {
  const m = metricOf(period, "grades");
  const kinds = m.kinds ?? [];
  const daily = kinds.find((k) => k.measure === "submit"), monthly = kinds.find((k) => k.measure === "take");
  return (
    <>
      <StatTiles items={[
        { label: "일일테스트 제출", value: daily ? pct(daily.average) : "—" }, { label: "월말평가 응시", value: monthly ? pct(monthly.average) : "—" },
        { label: "시험", value: `${m.tests ?? 0}건` }, { label: "종합(가중 평균)", value: pct(m.raw), className: "text-primary" },
        { label: "점수", value: pointsText(m, period) },
      ]} />
      <SectionTitle sub="일일테스트는 제출률 · 월말평가는 응시율 · 나머지는 점수율 — 종류마다 값을 낸 뒤 비중으로 가중 평균">종류별</SectionTitle>
      <DataTable headers={["종류", "셈", "대상", "값", "비중"]} kinds={["text", "text", "num", "num", "num"]}
        empty="이 달 일일테스트·월말평가 대상과 시험 기록이 없습니다."
        rows={kinds.map((k) => ({ key: k.kind, cells: [KIND_LABEL[k.kind], MEASURE[k.measure ?? "score"], targetText(k), pct(k.average), String(k.weight)] }))} />
      <SectionTitle sub={`${m.students ?? 0}명`}>학생별</SectionTitle>
      <DataTable headers={["학생 · 반", "일일테스트 제출", "월말평가", "시험", "평균 점수율"]} kinds={["text", "num", "text", "num", "num"]}
        rows={m.detail.map((r) => ({
          key: r.studentId,
          cells: [<StudentCell key="s" name={nameOf(r.studentId)} sub={[r.className || "—", r.kinds].filter(Boolean).join(" · ")} />,
            r.daily ? `${r.daily.done}/${r.daily.total}칸` : "—",
            r.monthly === undefined ? "—" : <StatusChip key="m" state={r.monthly ? "응시" : "미응시"} />,
            r.tests ? `${r.tests}건` : "—", pct(r.average)],
        }))} />
      <p className="mt-3 text-xs leading-relaxed">{m.reason}</p>
    </>
  );
}

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
          cells: [dayLabel(r.day), r.studentId ? nameOf(r.studentId) : "—", (r.studentId && schoolOf?.(r.studentId)) || "—", r.className || "—",
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
            cells: [dayLabel(r.day), STATUS[r.status] ?? r.status, r.expected ? `${r.expected}${r.basis ? ` (${BASIS[r.basis]})` : ""}` : "—",
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
