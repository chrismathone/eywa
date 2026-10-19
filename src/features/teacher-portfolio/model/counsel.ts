/**
 * 원생상담 — 그 달 담당 학생 중 **본인이 1회 이상 상담한 학생의 비율**(원장 2026-10-14 *"내 모든학생을 전부다 이번달에
 * 전부다 1회 이상 상담하면 만점"* · *"비율에 따라 점수 계산"*). 순수 함수.
 *
 * - 담당 학생 = 그 달 마지막 날(진행 중인 달은 집계 끝 날) 그 강사에게 **상담 의무**가 있는 학생(원장 2026-10-19 *"같은 과목에 여러 수업을
 *   듣는 경우 가장 많은 요일을 담당하는 선생님에게만 상담 의무"* — 수학 주 3회 중 2회 a · 1회 b면 a만). 학생이 그 과목에서 다니는 요일을
 *   교시 담당(없으면 담임)별로 세어 가장 많은 선생님(같으면 모두) · 자리(JJ·LAB) 칸은 세지 않는다(`counselDutyOf`).
 *   학원 설정 → 과목 운영에서 그 과목을 '담임 모두'로 두면 종전대로 학생 반의 담임 모두(원장 2026-10-14 *"부담임은 상담 안해도 됨"*).
 * - 상담 = 원생상담 기록 중 상담한 사람이 본인이고 상담 날짜가 그 달 안인 것. 한 학생은 몇 번 상담해도 한 명.
 * - 수치(raw) = 상담한 학생 ÷ 담당 학생 × 100(%). 담임 반이 없으면(부담임만 · 원어민 등) 자료 없음 — 점수는 그 지표의 '자료 없음' 규칙.
 * 옛 '원생상담'(후속 처리 기한 안 완료율)은 `follow` 지표로 남아 있다(옛 구성이 쓴다).
 */
import { between, kstDateOf, round1 } from "./dates";
import type { ChurnSource } from "./students";
import { METRIC_MAX, type CounselMetric, type CounselRow, type PeriodWindow, type PortfolioSnapshot } from "./types";

export function counselItem(input: {
  d: PortfolioSnapshot; duty: ChurnSource["counselDutyOf"]; teacherId: string; w: PeriodWindow; classNameOf: (id: string) => string;
}): CounselMetric {
  const { d, teacherId, w } = input;
  const firstDay = new Map<string, string>();
  for (const c of d.consultations) {
    const day = kstDateOf(c.consulted_at);
    if (c.counselor_id !== teacherId || !day || !between(day, w.start, w.end)) continue;
    const prev = firstDay.get(c.student_id);
    if (!prev || day < prev) firstDay.set(c.student_id, day);
  }
  const allHomerooms = new Set(d.settings.subjects.filter((s) => s.counselAllHomerooms).map((s) => s.key));
  const roster = [...input.duty(w.end, teacherId, (subject) => allHomerooms.has(subject))];
  const detail: CounselRow[] = roster.map(([studentId, classIds]) => ({
    studentId, consulted: firstDay.has(studentId), day: firstDay.get(studentId) ?? null,
    className: [...classIds].map(input.classNameOf).filter(Boolean).sort().join(", "),
  })).sort((a, b) => Number(a.consulted) - Number(b.consulted) || a.className.localeCompare(b.className, "ko"));
  const total = detail.length;
  const consulted = detail.filter((r) => r.consulted).length;
  return {
    id: "counsel", max: METRIC_MAX.counsel, total, consulted,
    value: total ? round1((METRIC_MAX.counsel * consulted) / total) : null,
    raw: total ? round1((100 * consulted) / total) : null,
    basis: total ? `상담 ${consulted} / 담당 ${total}명` : "이 달 상담 의무 학생 없음",
    reason: "그 달 상담 의무가 있는 담당 학생 중 본인이 1회 이상 상담한 학생의 비율입니다. 한 학생이 같은 과목을 여러 선생님에게 들으면 가장 많은 요일을 맡은 선생님만 의무가 있습니다(같으면 모두 · 과목 운영 설정으로 '담임 모두'를 고를 수 있습니다). 한 학생을 여러 번 상담해도 한 명으로 셉니다.",
    detail,
  };
}
