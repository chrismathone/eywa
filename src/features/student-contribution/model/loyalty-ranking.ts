import type { RankingFacts } from "./ranking-facts";
import type { FamilyLoyalty } from "./family-loyalty";
import { RANKING_KEYS, type RankingConfig, type RankingKey } from "./ranking-config";

export type RankingStudent = { id: string; name: string; school: string | null; grade: string | null; subjects: string[];
  facts: RankingFacts | null; family: FamilyLoyalty; attendanceAllowed: boolean; schoolAllowed: boolean };
export type RankingMetric = { value: number | null; points: number | null; note: string };
export type RankedStudent = RankingStudent & { metrics: Record<RankingKey, RankingMetric>; score: number | null; upper: number | null;
  known: number; enabled: number; complete: boolean; rank: number | null; top: number | null; band: number | null; tied: boolean };
const round = (n: number) => Math.round(n * 100) / 100;
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
      "환불 차감 수업료 순납부액에 해당 월 과목·동시수강 가산. 교재비 등 제외, 청구월 기준"),
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
export function buildLoyaltyRanking(students: readonly RankingStudent[], config: RankingConfig): RankedStudent[] {
  const inputs = students.map(s => ({ ...s, metrics: rankingValues(s, config) }));
  const maxima = Object.fromEntries(RANKING_KEYS.map(k => [k, Math.max(0, ...inputs.map(s => s.metrics[k].value ?? 0))])) as Record<RankingKey, number>;
  const rows: RankedStudent[] = inputs.map(s => {
    let score = 0, unknownWeight = 0, known = 0, enabled = 0;
    for (const k of RANKING_KEYS) {
      const value = s.metrics[k].value, weight = config.weights[k];
      if (weight <= 0) { s.metrics[k].points = 0; continue; }
      enabled++;
      if (value === null) { unknownWeight += weight; continue; }
      known++;
      // Count/money axes use cohort leader as 100%; attendance/school have intrinsic 100-point scales.
      const denominator = k === "attendance" || k === "school" ? 100 : maxima[k];
      s.metrics[k].points = denominator > 0 ? round(Math.min(1, Math.max(0, value / denominator)) * weight) : 0;
      score += s.metrics[k].points!;
    }
    return { ...s, score: known && s.facts ? round(score) : null, upper: known && s.facts ? round(Math.min(100, score + unknownWeight)) : null,
      known, enabled, complete: known === enabled, rank: null, top: null, band: null, tied: false };
  });
  const eligible = rows.filter(r => r.score !== null).sort((a, b) => b.score! - a.score! || a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
  const differentiated = new Set(eligible.map(r => r.score)).size > 1;
  for (const r of eligible) {
    const better = eligible.filter(s => s.score! > r.score!).length, equals = eligible.filter(s => s.score === r.score).length;
    r.rank = better + 1; r.tied = equals > 1;
    // Conservative tied boundary: all tied students use the group's ending percentile.
    r.top = round((better + equals) / eligible.length * 100);
    r.band = eligible.length >= 5 && differentiated ? Math.max(1, Math.min(5, Math.ceil(r.top / 20))) : null;
  }
  return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
}
