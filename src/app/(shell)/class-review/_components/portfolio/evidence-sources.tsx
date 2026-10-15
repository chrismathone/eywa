"use client";

import { KIND_LABEL } from "@/features/grades/unified/model";
import { metricOf } from "@/features/teacher-portfolio/model/types";
import { dayLabel, pointsText } from "@/features/teacher-portfolio/view";
import { StudentCell, type EvidenceProps } from "./evidence-records";
import { DataTable, SectionTitle, StatTiles, StatusChip } from "./parts";

/**
 * 계산이 들어온 원장 구성 지표 셋의 내역 — 성적 관리 · 학부모 만족도 · 강사 근태(원장 2026-10-15 *"계산 안된거 다음 단계라고 적힌거 다 해결해"*).
 * 숫자가 어떻게 나왔는지(종류별 평균과 비중 · 반영한 글과 클레임 · 센 날과 뺀 날)를 그대로 보인다.
 */
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);

function GradesEvidence({ period, nameOf }: EvidenceProps) {
  const m = metricOf(period, "grades");
  return (
    <>
      <StatTiles items={[
        { label: "시험", value: `${m.tests ?? 0}건` }, { label: "학생", value: `${m.students ?? 0}명` },
        { label: "점수율", value: pct(m.raw), className: "text-primary" }, { label: "점수", value: pointsText(m, period) },
      ]} />
      <SectionTitle sub="종류마다 평균을 낸 뒤 비중으로 가중 평균">종류별</SectionTitle>
      <DataTable headers={["종류", "시험", "평균 점수율", "비중"]} kinds={["text", "num", "num", "num"]} empty="이 달 담임 반 학생의 시험 기록이 없습니다."
        rows={(m.kinds ?? []).map((k) => ({ key: k.kind, cells: [KIND_LABEL[k.kind], `${k.count}건`, pct(k.average), String(k.weight)] }))} />
      <SectionTitle sub={`${m.students ?? 0}명`}>학생별</SectionTitle>
      <DataTable headers={["학생 · 반", "시험", "평균 점수율"]} kinds={["text", "num", "num"]}
        rows={m.detail.map((r) => ({ key: r.studentId, cells: [<StudentCell key="s" name={nameOf(r.studentId)} sub={`${r.className || "—"} · ${r.kinds}`} />, `${r.tests}건`, pct(r.average)] }))} />
      <p className="mt-3 text-xs leading-relaxed">{m.reason}</p>
    </>
  );
}

function SatisfactionEvidence({ period, nameOf }: EvidenceProps) {
  const m = metricOf(period, "satisfaction");
  const sign = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
  return (
    <>
      <StatTiles items={[
        { label: "가점 글", value: `${m.plus ?? 0}건` }, { label: "감점 글", value: `${m.minus ?? 0}건` },
        { label: "클레임·칭찬", value: `${m.claims ?? 0}건` }, { label: "점수", value: pointsText(m, period) },
      ]} />
      {m.waiting ? <p className="mt-3 text-xs">확인 대기 {m.waiting}건 — 위 도구줄의 [만족도 관리]에서 반영하기 전엔 점수에 들지 않습니다.</p> : null}
      <SectionTitle sub={`${m.detail.length}건`}>글 판정 · 클레임</SectionTitle>
      <DataTable headers={["날짜", "학생", "근거", "판정", "점수"]} kinds={["num", "text", "text", "text", "num"]}
        empty="이 달 반영한 학부모 글·클레임이 없습니다."
        rows={m.detail.map((r) => ({
          key: r.key,
          cells: [dayLabel(r.day), r.studentId ? nameOf(r.studentId) : "—", r.text ? `${r.source === "글" ? "“" : ""}${r.text}${r.source === "글" ? "”" : ""}` : "—",
            <StatusChip key="h" state={r.how} />, r.points === null ? "—" : sign(r.points)],
        }))} />
      <p className="mt-3 text-xs leading-relaxed">{m.reason}</p>
    </>
  );
}

const STATUS = { late: "지각", absent: "결근" } as const;
function PunctualityEvidence({ period }: EvidenceProps) {
  const m = metricOf(period, "punctuality");
  return (
    <>
      <StatTiles items={[
        { label: "지각", value: `${m.late ?? 0}회` }, { label: "결근", value: `${m.absent ?? 0}회` },
        { label: "뺀 날(휴가·휴원)", value: `${m.excused ?? 0}일` }, { label: "점수", value: pointsText(m, period) },
      ]} />
      <SectionTitle sub={m.manual ? "원장 직접 입력이 이 달 수치입니다" : `출퇴근 기록 ${m.days ?? 0}일`}>지각·결근한 날</SectionTitle>
      <DataTable headers={["날짜", "구분", "출근", "늦은 시간", "셈"]} kinds={["num", "text", "num", "num", "text"]}
        empty={m.days ? "이 달 지각·결근이 없습니다." : "이 달 출퇴근 기록이 없습니다."}
        rows={m.detail.map((r) => ({
          key: r.day,
          cells: [dayLabel(r.day), STATUS[r.status], r.checkIn ? new Date(r.checkIn).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }) : "—",
            r.lateMinutes ? `${r.lateMinutes}분` : "—", <StatusChip key="c" state={r.counted ? "셈" : `뺌 · ${r.excuse}`} />],
        }))} />
      <p className="mt-3 text-xs leading-relaxed">{m.reason}</p>
    </>
  );
}

/** 내역 분기(`evidence-impact.tsx`)가 부른다 — 계산 전 자리는 그쪽이 안내 카드로 먼저 거른다. */
export function SourceEvidence({ id, ...props }: EvidenceProps & { id: "grades" | "satisfaction" | "punctuality" }) {
  return id === "grades" ? <GradesEvidence {...props} /> : id === "satisfaction" ? <SatisfactionEvidence {...props} /> : <PunctualityEvidence {...props} />;
}
