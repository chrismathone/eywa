/** 원생상담 · 직원 평가 항목 — 기록을 그 달에 한 번만 센다. */
import { computeTotals, sanitizeAreas, type ScoreSheet } from "@/features/class-review/checklist";
import { between, kstDateOf, round1 } from "./dates";
import { METRIC_MAX, type FollowRow, type Metric, type PeriodWindow, type PortfolioSnapshot, type QualityRow, type SnapshotUser } from "./types";

/** 후속 기한이 이 달에 도래한 상담 중 마감 전 완료 비율. 상담을 많이 쓴 것 자체에는 점수를 주지 않는다. */
export function followMetric(d: PortfolioSnapshot, user: SnapshotUser, w: PeriodWindow, cutoff: string): Metric {
  const mine = d.consultations.filter((c) => c.counselor_id === user.id);
  const due = mine.filter((c) => between(c.follow_up_date, w.start, w.end));
  // 후속 완료 시각이 따로 없다. 마지막 수정이 마감 뒤면 당시 완료 여부를 확정하지 않는다.
  const settledBy = (c: (typeof mine)[number]) => { const on = kstDateOf(c.updated_at); return on !== null && on <= cutoff; };
  const unresolved = due.filter((c) => !settledBy(c)).length;
  const completed = due.filter((c) => c.follow_up_done && settledBy(c)).length;
  const consulted = mine.filter((c) => between(kstDateOf(c.consulted_at), w.start, w.end)).length;
  const detail: FollowRow[] = mine
    .filter((c) => between(kstDateOf(c.consulted_at), w.start, w.end) || between(c.follow_up_date, w.start, w.end))
    .map((c) => {
      const scored = between(c.follow_up_date, w.start, w.end);
      return {
        studentId: c.student_id, day: kstDateOf(c.consulted_at), due: c.follow_up_date, scored,
        state: !scored ? "후속 대상 아님" : !settledBy(c) ? "마감 시점 확인" : c.follow_up_done ? "완료" : "미완료",
      };
    });
  return {
    id: "follow", max: METRIC_MAX.follow, value: unresolved ? null : due.length ? round1((10 * completed) / due.length) : 0,
    raw: unresolved || !due.length ? null : (100 * completed) / due.length,
    basis: `상담 ${consulted}건 · 후속 기한 도래 ${due.length}건`,
    reason: unresolved
      ? `마감 이후 수정되었거나 수정 시각이 없는 ${unresolved}건은 마감 당시 완료 상태를 확인해야 합니다.`
      : due.length
        ? `마감 전 완료 ${completed} / ${due.length}건입니다.`
        : "이 달에 후속 처리 기한이 지정된 상담이 없습니다. 상담 기록 건수 자체에는 점수를 주지 않았습니다.",
    detail,
  };
}

/**
 * 이 달에 처음 완료된 타인 평가의 평균 ÷ 4 × 10. 자기 평가·미완성은 빼고, 없으면 0점이다.
 * 🔴 달은 **처음 완료된 시각**(`completedAt`)으로 정한다 — 저장할 때마다 바뀌는 제출 시각으로 정하면
 *    지난달 평가를 이번 달에 고쳤을 때 한 평가가 두 달에 들어간다. 그 칸이 없는 옛 장만 제출 시각을 쓴다.
 */
export function qualityMetric(d: PortfolioSnapshot, user: SnapshotUser, w: PeriodWindow): Metric {
  const sheets: (QualityRow & { rawAverage: number; version: string })[] = [];
  for (const r of d.reviews.filter((x) => (x.header?.teacherId || x.staff_user_id) === user.id)) {
    const areas = sanitizeAreas(r.areas);
    if (!areas) continue; // 옛·사용자 정의 문항의 판을 짐작하지 않는다.
    for (const [key, sheet] of Object.entries(r.submissions)) {
      const completed = kstDateOf(sheet.completedAt ?? sheet.submittedAt);
      if (key === "self" || key === user.id || sheet.byId === user.id || !between(completed, w.start, w.end)) continue;
      const scores = Array.isArray(sheet.scores) ? (sheet.scores as number[]) : [];
      const tally = computeTotals({ scores } satisfies Pick<ScoreSheet, "scores">, areas);
      if (!tally.complete) continue;
      const rawAverage = tally.total / scores.length;
      sheets.push({ rawAverage, average: round1(rawAverage), version: JSON.stringify(areas), date: completed, name: r.template_name || "평가지" });
    }
  }
  const sameVersion = new Set(sheets.map((s) => s.version)).size === 1;
  const average = sheets.length && sameVersion ? sheets.reduce((n, s) => n + s.rawAverage, 0) / sheets.length : null;
  const value = !sheets.length ? 0 : average === null ? null : round1((10 * average) / 4);
  return {
    id: "quality", max: METRIC_MAX.quality, value, raw: average, basis: `완료된 타인 평가 ${sheets.length}건`,
    reason: !sheets.length
      ? "해당 월에 완료된 타인 평가가 없습니다."
      : value === null
        ? "평가 문항이 달라 하나의 평균으로 합치지 않았습니다."
        : "처음 완료된 날이 속한 달에 반영했습니다. 자기 평가와 미완성 평가는 제외했습니다.",
    detail: sheets.map((s) => ({ date: s.date, name: s.name, average: s.average })),
  };
}
