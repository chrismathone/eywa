"use client";

import { useState } from "react";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { KIND_LABEL } from "@/features/grades/unified/model";
import { gradeRowsOf, scoredKindOf } from "@/features/teacher-portfolio/evidence-view";
import type { GradeKind, GradeKindStat, GradeRow } from "@/features/teacher-portfolio/model/source-types";
import { metricOf } from "@/features/teacher-portfolio/model/types";
import { pointsText } from "@/features/teacher-portfolio/view";
import { StudentCell, type EvidenceProps } from "./evidence-records";
import { DataTable, SectionTitle, StatTiles, StatusChip, type TableRow } from "./parts";

/**
 * 성적 관리 내역 — 종류별 값과 비중 · 학생별 줄(원장 2026-10-15). 학생별은 시험 종류 탭으로도 본다(원장 2026-10-16 *"성적 완료도 시험
 * 종류별로 탭 추가 (존재하는 시험만)"*) — 탭 = '전체' + 그 달 값이 선 종류만.
 */
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}%`);

/** 종류별 셈(원장 2026-10-15) — 이 칸이 생기기 전에 저장(마감)된 달은 전부 점수율이다. */
const MEASURE = { submit: "제출률", take: "응시율", score: "점수율" } as const;
const targetText = (k: GradeKindStat) => (k.measure === "submit" ? `${k.done ?? 0}/${k.count}칸` : k.measure === "take" ? `${k.done ?? 0}/${k.count}명` : `${k.count}건`);

/** 종류 탭의 표 — 셈(`measure`)으로 고른다: 10-15 전에 저장된 달은 일일테스트·월말평가도 점수율이다(리뷰 2026-10-16). */
function kindTable(kind: GradeKind | "all", measure: GradeKindStat["measure"], rows: readonly GradeRow[], student: (r: GradeRow, sub: string) => TableRow["cells"][number]) {
  if (kind === "all") return {
    headers: ["학생 · 반", "일일테스트 제출", "월말평가", "시험", "평균 점수율"], kinds: ["text", "num", "text", "num", "num"] as const,
    rows: rows.map((r) => ({
      key: r.studentId,
      cells: [student(r, [r.className || "—", r.kinds].filter(Boolean).join(" · ")),
        r.daily ? `${r.daily.done}/${r.daily.total}칸` : "—",
        r.monthly === undefined ? "—" : <StatusChip key="m" state={r.monthly ? "응시" : "미응시"} />,
        r.tests ? `${r.tests}건` : "—", pct(r.average)],
    })),
  };
  const picked = gradeRowsOf(rows, kind, measure);
  if (measure === "submit") return {
    headers: ["학생 · 반", "제출", "미제출", "제출률", "상태"], kinds: ["text", "num", "num", "num", "num"] as const,
    rows: picked.map((r) => {
      const d = r.daily!;
      return { key: r.studentId, cells: [student(r, r.className || "—"), `${d.done}칸`, `${d.total - d.done}칸`, pct(d.total ? (d.done / d.total) * 100 : null),
        <StatusChip key="c" state={d.done >= d.total ? "완료" : "미완료"} />] };
    }),
  };
  if (measure === "take") return {
    headers: ["학생 · 반", "월말평가"], kinds: ["text", "num"] as const,
    rows: picked.map((r) => ({ key: r.studentId, cells: [student(r, r.className || "—"), <StatusChip key="m" state={r.monthly ? "응시" : "미응시"} />] })),
  };
  return {
    headers: ["학생 · 반", "시험", "평균 점수율"], kinds: ["text", "num", "num"] as const,
    rows: picked.map((r) => {
      const s = scoredKindOf(r, kind)!;
      return { key: r.studentId, cells: [student(r, r.className || "—"), `${s.count}건`, pct(s.average)] };
    }),
  };
}

export function GradesEvidence({ period, nameOf, schoolOf }: EvidenceProps) {
  const m = metricOf(period, "grades");
  const kinds = m.kinds ?? [];
  const daily = kinds.find((k) => k.measure === "submit"), monthly = kinds.find((k) => k.measure === "take");
  const [picked, setPicked] = useState<GradeKind | "all">("all");
  // 다른 달·선생님으로 옮겨 그 종류가 없으면 '전체'로 본다.
  const tab = picked !== "all" && kinds.some((k) => k.kind === picked) ? picked : "all";
  const table = kindTable(tab, kinds.find((k) => k.kind === tab)?.measure, m.detail, (r, sub) => <StudentCell key="s" name={nameOf(r.studentId)} school={schoolOf?.(r.studentId)} sub={sub} />);
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
      <div className="mt-5 mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-baseline gap-x-2 text-sm font-bold">학생별 <span className="num text-xs font-medium">{table.rows.length}명</span></h4>
        {kinds.length ? (
          <ToolbarSegment wrap>
            <ToolbarSegmentItem active={tab === "all"} onClick={() => setPicked("all")}>전체</ToolbarSegmentItem>
            {kinds.map((k) => (
              <ToolbarSegmentItem key={k.kind} active={tab === k.kind} onClick={() => setPicked(k.kind)}>{KIND_LABEL[k.kind]}</ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
        ) : null}
      </div>
      <DataTable headers={table.headers} kinds={[...table.kinds]} rows={table.rows} />
      <p className="mt-3 text-xs leading-relaxed">{m.reason}</p>
    </>
  );
}
