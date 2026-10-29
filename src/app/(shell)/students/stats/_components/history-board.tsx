"use client";

import { useState } from "react";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { DASHBOARD_SUBJECT_COLORS } from "@/features/dashboard/overview/subject-colors";
import { saveStudentStatsPrefs } from "@/features/students/stats/server/prefs-actions";
import { firstMonthWith, yearlyHistory, type HistoryField, type HistoryMonth } from "@/features/students/stats/history";
import type { HistoryView } from "@/features/students/stats/model";
import { StatCard } from "./stat-card";
import { TrendChart, type ChartSeries } from "./trend-chart";
import { HistoryTable } from "./history-table";

const longMonth = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
/** 시각(UTC) → KST 'M월 D일'. */
const kstDayText = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString();
  return `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
};
const axisMonth = (m: string) => `${m.slice(2, 4)}.${m.slice(5, 7)}`;
/** 나간 학생 칸 이름 — 퇴원일이 아니라 청구로 센 값이라 그 뜻을 이름에 담는다(메이크에듀 퇴원일은 2025년부터만 남아 있다). */
const STOPPED_NAME = "청구가 끊긴 학생";
/**
 * 프로그램 이름·색 — 원생 통계 강좌수 선과 같은 값(화면이 학원 설정으로 풀어 넘긴다). `subjects` = 그 밖의 과목(국어·과학…)마다 — 재원생 추이
 * 과목별 선과 같은 이름·색(원장 2026-10-28 *"과목별로 분리가능한 수준까지 쫙 분리"*).
 */
export type HistoryPrograms = Record<"math" | "injaewon" | "eie", { label: string; color: string }> & {
  subjects?: Record<string, { label: string; color: string }>;
};
type Line = { key: HistoryField; name: string; color: string; strong?: boolean };

/**
 * 선 — 프로그램 칸(수업명으로 가른 값 · 원장 2026-10-21 *"수학과 영어로 구분 못하나? 수업명 가지고?"*)이 있으면 **수학 · 인재원 영어 · EiE**
 * (+ 그 밖의 과목 — 값이 있을 때만 · 과목 모름은 보이지 않는다), 없으면 종전대로 EiE 외 수업 · EiE. 메이크에듀 재원생 기록 = 참고(회색).
 * EiE 청구가 없는 지점은 EiE를 가르지 않으니 첫 선의 이름이 그냥 '수업료가 청구된 학생'이다(없는 프로그램 이름을 붙이지 않는다).
 */
function historyLines(hasEie: boolean, split: boolean, programs: HistoryPrograms): Line[] {
  const reference: Line = { key: "enrolledRecord", name: "메이크에듀 재원생 기록", color: "var(--color-muted-foreground)" };
  if (!split) {
    return [
      { key: "payingGeneral", name: hasEie ? "EiE 외 수업" : "수업료가 청구된 학생", color: "var(--color-primary)", strong: true },
      { key: "payingEie", name: programs.eie.label, color: programs.eie.color },
      reference,
    ];
  }
  return [
    { key: "payingMath", name: programs.math.label, color: programs.math.color, strong: true },
    { key: "payingInjaewon", name: programs.injaewon.label, color: programs.injaewon.color, strong: true },
    { key: "payingEie", name: programs.eie.label, color: programs.eie.color, strong: true },
    { key: "payingOther", name: "그 밖의 과목", color: DASHBOARD_SUBJECT_COLORS.other },
    // 과목 모름은 세우지 않는다(원장 2026-10-29 *"과목 모름은 그냥 제거"* — 선·표 열 모두 · 값은 DB에 그대로).
    reference,
  ];
}

/**
 * '지난 기록'(원장 2026-10-20) — 메이크에듀(2020~2025) + 에이와 청구(2026~)를 한 선으로 이은 '수업료가 청구된 학생'과 '실제 신규'.
 * 재원생 추이(에이와 기록이 갖춰진 달부터)와 **뜻이 다른 숫자**라 따로 둔다 — 청구된 학생 ≠ 재원생(휴원·시작 전·장부상 원생은 빠지고,
 * 미납도 든다). 안내 문구는 데이터에서 나온다(추정 칸 · EiE가 처음 실린 달 · 메이크에듀 재원생 기록 기간 · 에이와 청구 시작 달) — 지점마다 다르다.
 */
export function HistoryBoard({
  months,
  aywaFrom,
  aywaAt,
  payingHidden,
  initialView,
  wide,
  programs,
}: {
  months: HistoryMonth[];
  aywaFrom: string | null;
  /** 에이와 쪽 값을 마지막으로 센 시각(밤 집계) — '언제 밤 기준'을 적는다. */
  aywaAt: string | null;
  /** 수납 권한이 없어 서버가 청구 칸을 빼고 보냈다. */
  payingHidden: boolean;
  initialView: HistoryView;
  wide: boolean;
  programs: HistoryPrograms;
}) {
  const [view, setView] = useState<HistoryView>(initialView);
  const years = yearlyHistory(months);
  const yearly = view === "yearly";
  const labels = yearly ? years.map((y) => y.year) : months.map((m) => axisMonth(m.month));
  const tips = yearly ? years.map((y) => `${y.year}년${y.months < 12 ? ` (${y.months}개월)` : ""}`) : months.map((m) => longMonth(m.month));
  const pick = (f: HistoryField) => (yearly ? years.map((y) => y[f] ?? null) : months.map((m) => m[f] ?? null));
  const hasEie = months.some((m) => m.payingEie !== undefined);
  // 프로그램으로 나눠 그리는 것은 **청구 학생이 있는 모든 달에 프로그램 칸이 있을 때만** — 일부 달만 있으면(메이크에듀 백필 전 · 밤 집계가
  // 재료를 못 읽은 날) 그 밖의 달이 차트에서 빠지므로 종전 선(EiE 외 수업 · EiE)으로 그린다(리뷰 2026-10-21).
  const paid = months.filter((m) => m.payingGeneral !== undefined);
  const split = paid.length > 0 && paid.every((m) => m.payingMath !== undefined);
  // 값이 늘 0인 프로그램(수학만 하는 지점의 영어 등)은 선을 세우지 않는다.
  // 그 밖의 과목을 과목마다 — '그 밖의 과목' 학생이 있는 **모든 달에** 과목 묶음이 있을 때만 그 한 선 대신 과목마다 선(값이 늘 0인 과목은
  // 세우지 않는다). 일부 달만 있으면(배포 뒤 첫 밤 집계 전의 에이와 줄 등) 그 달 학생이 빠지므로 종전 한 선으로(리뷰 2026-10-28).
  const subjectsEverywhere = months.every((m) => !(m.payingOther ?? 0) || m.subjects !== undefined);
  const subjectKeys = split && subjectsEverywhere ? [...new Set(months.flatMap((m) => Object.keys(m.subjects ?? {})))].filter((k) => months.some((m) => (m.subjects?.[k] ?? 0) > 0)) : [];
  const pickSubject = (k: string) => (yearly ? years.map((y) => y.subjects?.[k] ?? null) : months.map((m) => m.subjects?.[k] ?? null));
  const subjectSeries: ChartSeries[] = subjectKeys.map((k) => ({
    key: `subject:${k}`,
    name: programs.subjects?.[k]?.label ?? k,
    color: programs.subjects?.[k]?.color ?? DASHBOARD_SUBJECT_COLORS.other,
    values: pickSubject(k),
  }));
  const lines = historyLines(hasEie, split, programs)
    .filter((l) => (l.key === "enrolledRecord" || l.key === "payingGeneral" ? months.some((m) => m[l.key] !== undefined) : months.some((m) => (m[l.key] ?? 0) > 0)))
    .filter((l) => !(subjectSeries.length && l.key === "payingOther"));
  // 과목 선은 '그 밖의 과목' 자리(메이크에듀 재원생 기록 앞)에.
  const tailAt = lines.findIndex((l) => l.key === "enrolledRecord");
  const ordered = tailAt < 0 ? [...lines.map((l) => ({ ...l, values: pick(l.key) })), ...subjectSeries]
    : [...lines.slice(0, tailAt).map((l) => ({ ...l, values: pick(l.key) })), ...subjectSeries, ...lines.slice(tailAt).map((l) => ({ ...l, values: pick(l.key) }))];
  const paying: ChartSeries[] = ordered;
  // 들어온 학생(실제 신규)과 나간 학생(청구가 끊긴 학생 — 청구 기준 · 수납 권한이 있을 때만 서버가 싣는다)을 한 그래프에.
  const hasStopped = months.some((m) => m.stoppedPaying !== undefined);
  // 연도별에서 셀 수 있는 마지막 달(다음 두 달이 끝난 달)이 든 해는 청구가 끊긴 학생을 다 셀 수 없다 — 신규와 셈한 달 수가 다르면 이름에 밝힌다
  // (리뷰 2026-10-21). 🔴 마지막 해가 아니라 **그 달이 든 해**로 본다 — 해가 바뀐 1~2월엔 셀 수 있는 마지막 달이 지난해에 있다(재리뷰).
  const stoppedThrough = [...months].reverse().find((m) => m.stoppedPaying !== undefined)?.month ?? null;
  const stoppedYear = stoppedThrough ? years.find((y) => y.year === stoppedThrough.slice(0, 4)) : undefined;
  const partialStopped = yearly && stoppedYear && (stoppedYear.fieldMonths.stoppedPaying ?? 0) < (stoppedYear.fieldMonths.newReal ?? 0);
  const fresh: ChartSeries[] = [
    { key: "newReal", name: "실제 신규", color: "var(--color-primary)", strong: true, values: pick("newReal") },
    ...(hasStopped
      ? [
          {
            key: "stoppedPaying",
            name: partialStopped ? `${STOPPED_NAME}(${stoppedYear!.year}년은 ${Number(stoppedThrough!.slice(5, 7))}월까지)` : STOPPED_NAME,
            color: "var(--color-danger)",
            values: pick("stoppedPaying"),
          },
        ]
      : []),
  ];
  const notes = historyNotes(months, aywaFrom, aywaAt, payingHidden, split);
  return (
    <StatCard
      id="history"
      title={wide ? "지난 기록 (학원 전체)" : "지난 기록"}
      note={`${months[0] ? `${longMonth(months[0].month)}부터` : "기록 없음"} · ${payingHidden ? "실제로 수업을 시작한 신규" : "수업료가 청구된 학생과 실제로 수업을 시작한 신규"} · ${yearly ? `연도별 = 학생 수는 월평균 · 신규${hasStopped ? "·청구가 끊긴 학생은" : "는"} 합(같은 학생이 다시 오면 또 센다)` : "달마다"}`}
      tools={
        <ToolbarSegment label="보기">
          {(["yearly", "monthly"] as const).map((v) => (
            <ToolbarSegmentItem key={v} active={view === v} onClick={() => { setView(v); void saveStudentStatsPrefs({ historyView: v }).catch(() => undefined); }}>
              {v === "yearly" ? "연도별" : "월별"}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
      }
    >
      {paying.length ? (
        <>
          <h3 className="text-foreground text-sm font-bold">{payingHidden ? "메이크에듀 재원생 기록" : "수업료가 청구된 학생"}{yearly ? " (월평균)" : ""}</h3>
          <TrendChart labels={labels} tooltipLabels={tips} series={paying} kind="line" />
        </>
      ) : null}
      <h3 className="text-foreground text-sm font-bold">
        실제 신규{hasStopped ? ` · ${STOPPED_NAME}` : ""}
        {yearly ? " (합)" : ""}
      </h3>
      <TrendChart labels={labels} tooltipLabels={tips} series={fresh} kind="bar" legend={hasStopped} />
      {notes.length ? (
        <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-xs break-keep">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
      <HistoryTable
        years={years}
        hasEie={hasEie}
        split={split}
        programs={programs}
        shown={new Set(lines.map((l) => l.key))}
        subjectKeys={subjectKeys}
      />
    </StatCard>
  );
}

/** 안내 문구 — 값이 있는 것만(지점마다 다르다). */
function historyNotes(months: readonly HistoryMonth[], aywaFrom: string | null, aywaAt: string | null, payingHidden: boolean, split: boolean): string[] {
  const out: string[] = [];
  if (payingHidden) out.push("수업료가 청구된 학생 수는 수납 권한이 있으면 보입니다.");
  if (split) {
    out.push(
      "과목은 청구 항목의 수업 이름으로 가른 값입니다(반 이름 · 과목 이름 · 같은 선생님의 다른 수업으로 — 이름으로 못 가른 수업은 과목 선에 들지 않습니다). 두 과목을 들으면 양쪽에 들어, 선을 모두 더하면 실제 학생 수보다 큽니다.",
    );
  }
  const estimated = months.filter((m) => m.estimated.includes("payingGeneral")).map((m) => longMonth(m.month));
  if (estimated.length) out.push(`${estimated.join(" · ")}은 청구 방식이 바뀌어 그달 청구가 비어 있어, 그달 실제로 낸 수업료로 메웠습니다(추정).`);
  // 건너뛴 달(원장 2026-10-28 *"이상할정도로 적은달은 건너뛰는게 차라리 나음. 애매한것보다"*) — 청구 칸이 비어 선이 끊긴다.
  const skipped = months.filter((m) => m.skipped).map((m) => longMonth(m.month));
  if (skipped.length) out.push(`${skipped.join(" · ")}은 그달 청구가 비정상으로 적어(청구 방식이 바뀐 달 · 휴원기 등) 수업료가 청구된 학생 수를 비웠습니다 — 메우지 않았습니다.`);
  // 메이크에듀 2025-05 전 EiE·일부 수업료는 '교재' 구분으로 청구됐다(원장 2026-10-28 정정) — 다시 센 메이크에듀 줄에서 EiE가 그 전부터 보인다.
  const eieFirst = firstMonthWith(months, "payingEie");
  if (eieFirst && eieFirst < "2025-05") out.push("메이크에듀 2025년 5월 전에는 EiE 등 일부 수업료가 '교재' 구분으로 청구돼, 요일·시간 표기가 있거나 8만 원 이상인 교재 줄을 수업료로 셌습니다.");
  const eieFrom = firstMonthWith(months, "payingEie");
  const genFrom = firstMonthWith(months, "payingGeneral");
  const eieLate = !!(eieFrom && genFrom && eieFrom > genFrom);
  if (eieLate) out.push(`EiE 수업료는 ${longMonth(eieFrom!)}부터 이 기록에 있습니다 — 그 전 EiE 학생 수는 남은 자료가 없습니다.`);
  const recFrom = firstMonthWith(months, "enrolledRecord");
  const recTo = [...months].reverse().find((m) => m.enrolledRecord !== undefined)?.month;
  if (recFrom && recTo) out.push(`메이크에듀 재원생 기록(${longMonth(recFrom)}~${longMonth(recTo)})은 메이크에듀가 달마다 남긴 숫자입니다 — 휴원·수업 시작 전 학생도 들어 있어 수업료가 청구된 학생 수와 다를 수 있습니다.`);
  const evidence = aywaFrom ? " · 에이와 기록은 출석이나 7일 넘게 다닌 반 수업도" : "";
  const eieGap = eieLate ? ` EiE 수업료가 기록에 없던 ${longMonth(eieFrom!)} 전에 EiE만 다닌 학생은 빠질 수 있습니다.` : "";
  out.push(`실제 신규 = 그달 등록 중 실제로 수업을 시작한 학생(그 뒤 수업료 청구 — 취소·환불 제외${evidence}) — 상담만 하고 자료로 등록된 사람과, 직전 두 달에 청구가 있던(등록일만 고쳐진) 재원생은 뺍니다.${eieGap}`);
  const stoppedLast = [...months].reverse().find((m) => m.stoppedPaying !== undefined)?.month;
  // 메이크에듀 청구 방식이 바뀐 2025-03~05(그 뒤로는 다음 달 수업료를 미리 청구) — 판정 창에 그 달들이 들어가 값이 흔들릴 수 있다(Codex 협의 2026-10-21).
  if (months.some((m) => m.month >= "2025-03" && m.month <= "2025-05" && m.stoppedPaying !== undefined)) {
    out.push(`2025년 3~5월은 메이크에듀 청구 방식이 바뀐 때(그 뒤로는 다음 달 수업료를 미리 청구)라 이 달들의 ${STOPPED_NAME} 수는 흔들릴 수 있습니다.`);
  }
  if (stoppedLast) {
    out.push(
      `${STOPPED_NAME} = 그달 수업료 청구가 있고 이후 두 달 연속 청구가 없는 학생입니다(마지막 청구달에 셉니다 · 퇴원 기록이 2025년부터만 남아 청구로 셉니다 — 휴원·방학 뒤 돌아온 학생도 듭니다). ${longMonth(stoppedLast)} 뒤는 다음 두 달이 아직 끝나지 않아 비어 있습니다.`,
    );
  }
  if (aywaFrom && genFrom && aywaFrom > genFrom) out.push(`${longMonth(aywaFrom)}부터는 에이와 청구로 셉니다(그 전은 메이크에듀 수납 기록).`);
  // 에이와 쪽은 밤마다 다시 센다(원생 매일 기록 23:55) — 오늘 바뀐 것은 내일 반영된다(위 '월별 기록'은 지금 값).
  if (aywaAt) out.push(`에이와 쪽 숫자는 ${kstDayText(aywaAt)} 밤 기준입니다 — 밤마다 다시 세어 오늘 바뀐 것은 다음 날 반영됩니다.`);
  return out;
}
