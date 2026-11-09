import type { RankingFacts } from "./ranking-facts";
import type { FamilyLoyalty } from "./family-loyalty";
import { RANKING_KEYS, type RankingConfig, type RankingKey } from "./ranking-config";

export type RankingStudent = { id: string; name: string; school: string | null; grade: string | null; subjects: string[];
  facts: RankingFacts | null; family: FamilyLoyalty; attendanceAllowed: boolean; schoolAllowed: boolean };
export type RankingMetric = { value: number | null; points: number | null; note: string };
export type RankedStudent = RankingStudent & { metrics: Record<RankingKey, RankingMetric>; score: number | null; upper: number | null;
  known: number; enabled: number; complete: boolean; rank: number | null; top: number | null; band: number | null; tied: boolean };
const round = (n: number) => Math.round(n * 100) / 100;
/** 시안: 항목별 가산점(단위당). 수강기간이 바탕이고 나머지는 그보다 작게 — 한 항목이 순위를 뒤집지 않게. */
export const LOYALTY_POINTS = {
  tenurePerMonth: 1, // 유효 수강 1개월(추가 과목·동시수강 가산개월 포함) = 1점
  paymentPerLevelMonth: 0.5, // 그 학교급 한 달 평균 수강료만큼 납부 = 0.5점
  familyShare: 0.2, // 지금 함께 재원하는 형제의 (수강기간 + 납부) 점수 합의 20%를 이 학생에게
  familyMax: 15, // 가족 가산점 상한 — 형제가 많아도 수강기간 15개월치를 넘지 않게
  seminarPerEvent: 2, // 설명회 참석 1회 = 2점
  attendanceMax: 5, // 출석률 100% = 5점
  schoolMax: 5, // 학교 성적 지수 100 = 5점
} as const;
const nonnegative = (n: number) => Math.max(0, n);
export function rankingValues(student: RankingStudent, config: RankingConfig): Record<RankingKey, RankingMetric> {
  const f = student.facts, b = f?.billing;
  const metric = (value: number | null, note: string): RankingMetric => ({ value, points: null, note });
  const knownSubjects = !!b && b.months > 0 && b.unknownMonths === 0;
  const familyReady = student.family.state === "ready";
  const family = familyReady && !student.family.selfActive ? 0
    : familyReady && student.family.activeSiblings === 0 ? 0
    : familyReady && knownSubjects ? b!.subjectMonths * student.family.activeSiblings! : null;
  const current = f?.school.current ?? null, improvement = f?.school.improvement ?? null;
  // Improvement index: +20 percentage points reaches 100. Declines are known 0, not missing.
  const improved = improvement === null ? null : Math.min(100, nonnegative(improvement) * 5);
  const school = config.gradeMode === "current" ? current : config.gradeMode === "improvement" ? improved
    : current !== null && improved !== null ? (current + improved) / 2 : null;
  const a = f?.attendance;
  return {
    tenure: metric(knownSubjects ? round(b!.months + Math.max(0, b!.subjectMonths - b!.months) * config.extraSubjectBonus + b!.concurrentMonths * config.concurrentBonus) : null,
      !b ? "집계 필요" : b.unknownMonths ? `과목 미확인 ${b.unknownMonths}개월` : "수업료 청구가 유효한 달 + 추가 과목·동시수강 가산"),
    payment: metric(knownSubjects ? round(nonnegative(b!.paid + b!.extraSubjectPaid * config.extraSubjectBonus + b!.concurrentPaid * config.concurrentBonus)) : null,
      "환불 차감 수업료 순납부액에 해당 월 과목·동시수강 가산. 교재비 등 제외, 청구월 기준 · 점수는 같은 학교급(초·중·고) 1등 대비"),
    family: metric(family, familyReady ? "본인 누적 과목개월 × 현재 재원 형제자매 수(본인 제외). 과거 가족 동시 재원기간을 뜻하지 않습니다." : "가족 연결 확인 또는 열람 범위 확인 필요"),
    seminar: metric(f?.seminar.attended != null && !f.seminar.pending ? f.seminar.attended : null,
      f?.seminar.pending ? `참석 확정 ${f.seminar.attended ?? "미확인"}회 · 신청만 확인 ${f.seminar.registeredOnly}회 · 명단 확인 필요` : "명단 연결 범위 안의 참석 확인 행사 수. 같은 행사 중복 제외"),
    attendance: metric(student.attendanceAllowed && a && a.scheduled > 0 && a.recorded === a.scheduled ? a.rate : null,
      student.attendanceAllowed ? `정규 예정 ${a?.scheduled ?? 0}교시 / 기록 ${a?.recorded ?? 0}교시. 정상 1, 지각·조퇴 0.5, 결석 0. 오늘 수업 제외` : "출결 열람 권한 확인 필요"),
    school: metric(student.schoolAllowed ? school : null,
      config.gradeMode === "current" ? "과목별 최근 학교시험의 100점 환산 평균" : config.gradeMode === "both" ? "현재 성적 지수와 향상 지수를 각 50% 반영" : "같은 연도·과목·시험종류의 최근 2회 차이. +20%p 이상이면 성적 항목 만점"),
  };
}
/** Search/subject filters run after this function; the comparison cohort never changes while filtering. */
export function buildLoyaltyRanking(students: readonly RankingStudent[], config: RankingConfig,
  detail?: { totals?: Map<string, number | null>; familyPoints?: Map<string, number | null> }): RankedStudent[] {
  const inputs = students.map(s => ({ ...s, metrics: rankingValues(s, config) }));
  // 시안: 100점 환산을 버리고 '단위당 가산점'을 그냥 더한다(원장 2026-11-09 *"100점 환산하지말고 … 각 위치에 적절한 가산점으로"*).
  // 배점(weights)은 켜고 끄는 스위치로만 쓴다(0이면 그 항목 제외). 단위 값은 LOYALTY_POINTS 한 곳.
  const levelOf = (grade: string | null) => { const c = grade?.trim().charAt(0); return c === "초" || c === "중" || c === "고" ? c : null; };
  // 총 납부액 = '그 학교급 한 달 평균 수강료 몇 달치'로 바꿔 센다 — 고등 수강료가 원래 높아 같은 기간에 점수가 크게 벌어지지 않게.
  const levelPaid = new Map<string, { paid: number; months: number }>();
  for (const s of inputs) {
    const lv = levelOf(s.grade) ?? "전체", b = s.facts?.billing;
    if (!b || b.months <= 0 || s.metrics.payment.value === null) continue;
    for (const key of new Set([lv, "전체"])) { const cur = levelPaid.get(key) ?? { paid: 0, months: 0 }; cur.paid += b.paid; cur.months += b.months; levelPaid.set(key, cur); }
  }
  const monthlyOf = (grade: string | null) => { const v = levelPaid.get(levelOf(grade) ?? "전체") ?? levelPaid.get("전체"); return v && v.months > 0 ? v.paid / v.months : 0; };
  // 형제 가산의 바탕 = 각 학생 자신의 수강기간 + 납부 점수(가족 점수끼리 서로 불어나지 않게 가족은 빼고 센다).
  const ownBase = (s: (typeof inputs)[number]) => {
    const t = s.metrics.tenure.value, p = s.metrics.payment.value, m = monthlyOf(s.grade);
    return (t !== null && config.weights.tenure > 0 ? t * LOYALTY_POINTS.tenurePerMonth : 0)
      + (p !== null && m > 0 && config.weights.payment > 0 ? (p / m) * LOYALTY_POINTS.paymentPerLevelMonth : 0);
  };
  const baseById = new Map(inputs.map(s => [s.id, ownBase(s)]));
  const pointsOf = (s: (typeof inputs)[number], k: RankingKey, value: number): number => {
    const P = LOYALTY_POINTS;
    if (k === "tenure") return value * P.tenurePerMonth;
    if (k === "payment") { const m = monthlyOf(s.grade); return m > 0 ? (value / m) * P.paymentPerLevelMonth : 0; }
    if (k === "family") {
      // 함께 재원 중인 형제(본인 제외)의 수강기간·납부 점수를 조금 나눠 받는다. 비교 범위 밖 형제는 알 수 없어 넣지 않는다.
      const siblings = s.family.state === "ready" && s.family.selfActive ? s.family.members.filter(m => m.active && m.id !== s.id) : [];
      const base = siblings.reduce((sum, m) => sum + (baseById.get(m.id) ?? 0), 0);
      return Math.min(P.familyMax, base * P.familyShare);
    }
    if (k === "seminar") return value * P.seminarPerEvent;
    if (k === "attendance") return (Math.max(0, Math.min(100, value)) / 100) * P.attendanceMax;
    return (Math.max(0, Math.min(100, value)) / 100) * P.schoolMax;
  };
  const rows: RankedStudent[] = inputs.map(s => {
    let score = 0, known = 0, enabled = 0;
    for (const k of RANKING_KEYS) {
      const value = s.metrics[k].value, weight = config.weights[k];
      if (weight <= 0) { s.metrics[k].points = 0; continue; }
      enabled++;
      if (value === null) continue;
      known++;
      s.metrics[k].points = round(pointsOf(s, k, value));
      // 가족 칸은 형제에게서 나눠 받은 가산점 자체가 기록이다(과목개월 × 형제 수가 아니라).
      if (k === "family") s.metrics.family = { ...s.metrics.family, value: s.metrics[k].points, note: "함께 재원 중인 형제의 수강기간·납부 점수 합의 20%(최대 15점)" };
      score += s.metrics[k].points!;
    }
    // 학생 상세와 같은 점수가 있으면 그것을 그대로 쓴다. 가족 칸 = 상세의 가족 가점(예: 3남매 +250) 그대로.
    if (detail?.familyPoints?.has(s.id)) { const fp = detail.familyPoints.get(s.id)!; s.metrics.family = { ...s.metrics.family, value: fp, points: fp, note: "학생 상세의 가족 가점 그대로" }; }
    if (detail?.totals) { const t = detail.totals.get(s.id) ?? null; return { ...s, score: t, upper: t, known, enabled, complete: known === enabled, rank: null, top: null, band: null, tied: false }; }
    return { ...s, score: known && s.facts ? round(score) : null, upper: known && s.facts ? round(score) : null,
      known, enabled, complete: known === enabled, rank: null, top: null, band: null, tied: false };
  });
  const eligible = rows.filter(r => r.score !== null).sort((a, b) => b.score! - a.score! || a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
  const differentiated = new Set(eligible.map(r => r.score)).size > 1;
  for (const r of eligible) {
    const better = eligible.filter(s => s.score! > r.score!).length, equals = eligible.filter(s => s.score === r.score).length;
    r.rank = better + 1; r.tied = equals > 1;
    // Conservative tied boundary: all tied students use the group's ending percentile.
    r.top = round((better + equals) / eligible.length * 100);
    // 시안: 별 9등급(수능식 누적 4·11·23·40·60·77·89·96·100%) — relative-score의 CONTRIBUTION_TIERS와 같은 구간.
    r.band = eligible.length >= 5 && differentiated ? Math.max(1, [4, 11, 23, 40, 60, 77, 89, 96, 100].findIndex(c => r.top! <= c) + 1 || 9) : null;
  }
  return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
}
