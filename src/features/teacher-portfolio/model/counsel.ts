/**
 * 원생상담 — 그 달 담당 학생 중 **본인이 1회 이상 상담한 학생의 비율**(원장 2026-10-14 *"내 모든학생을 전부다 이번달에
 * 전부다 1회 이상 상담하면 만점"* · *"비율에 따라 점수 계산"*). 순수 함수.
 *
 * - 담당 학생 = 그 달 마지막 날(진행 중인 달은 집계 끝 날) 그 강사가 **담임인 반**의 학생 — 원생 수 · 퇴원율과 같은 명단에서 담임만
 *   (원장 2026-10-14 *"부담임은 상담 안해도 됨 … 담당인 반에 대한 학생만 월1회 상담"* — 수학 JJ 수업은 전부 부담임 수업(주 1회)이다).
 * - 상담 = 원생상담 기록 중 상담한 사람이 본인이고 상담 날짜가 그 달 안인 것. 한 학생은 몇 번 상담해도 한 명.
 * - 수치(raw) = 상담한 학생 ÷ 담당 학생 × 100(%). 담임 반이 없으면(부담임만 · 원어민 등) 자료 없음 — 점수는 그 지표의 '자료 없음' 규칙.
 * 옛 '원생상담'(후속 처리 기한 안 완료율)은 `follow` 지표로 남아 있다(옛 구성이 쓴다).
 */
import { between, kstDateOf, round1 } from "./dates";
import type { ChurnSource } from "./students";
import { METRIC_MAX, type CounselMetric, type CounselRow, type PeriodWindow, type PortfolioSnapshot } from "./types";

export function counselItem(input: {
  d: PortfolioSnapshot; roster: ChurnSource["rosterOf"]; teacherId: string; w: PeriodWindow; classNameOf: (id: string) => string;
}): CounselMetric {
  const { d, teacherId, w } = input;
  const firstDay = new Map<string, string>();
  for (const c of d.consultations) {
    const day = kstDateOf(c.consulted_at);
    if (c.counselor_id !== teacherId || !day || !between(day, w.start, w.end)) continue;
    const prev = firstDay.get(c.student_id);
    if (!prev || day < prev) firstDay.set(c.student_id, day);
  }
  const roster = [...input.roster(w.end, teacherId)].filter(([, rel]) => rel.homeClasses.size > 0);
  const detail: CounselRow[] = roster.map(([studentId, rel]) => ({
    studentId, consulted: firstDay.has(studentId), day: firstDay.get(studentId) ?? null,
    className: [...rel.homeClasses].map(input.classNameOf).filter(Boolean).sort().join(", "),
  })).sort((a, b) => Number(a.consulted) - Number(b.consulted) || a.className.localeCompare(b.className, "ko"));
  const total = detail.length;
  const consulted = detail.filter((r) => r.consulted).length;
  return {
    id: "counsel", max: METRIC_MAX.counsel, total, consulted,
    value: total ? round1((METRIC_MAX.counsel * consulted) / total) : null,
    raw: total ? round1((100 * consulted) / total) : null,
    basis: total ? `상담 ${consulted} / 담임 반 ${total}명` : "이 달 담임 반 학생 없음",
    reason: "그 달 담임인 반의 학생 중 본인이 1회 이상 상담한 학생의 비율입니다(부담임으로만 맡은 학생은 뺍니다). 한 학생을 여러 번 상담해도 한 명으로 셉니다. 원생상담 기록의 상담한 사람·상담 날짜로 판정합니다.",
    detail,
  };
}
