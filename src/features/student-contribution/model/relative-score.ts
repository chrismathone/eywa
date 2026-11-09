import { loyaltyTotal, type FamilyLoyalty } from "./family-loyalty";
import { scoreRaws } from "./calc";
import type { ContributionConfig, Raws } from "./config";

export type RelativeMetric = "total" | "recent";
export type RelativeScope = "all" | "grade" | "tenure";
/** 시안: 별 9등급(반 개 포함) — 수능식 누적 상위 4·11·23·40·60·77·89·96·100%. 1등급 ★5 → 9등급 ★1(반 개씩). 점수 없음·보류 = 별 0개. */
export const CONTRIBUTION_TIERS = [
  { name: "1등급", stars: 5, ceiling: 4, range: "상위 4% 이내" },
  { name: "2등급", stars: 4.5, ceiling: 11, range: "4% 초과~11%" },
  { name: "3등급", stars: 4, ceiling: 23, range: "11% 초과~23%" },
  { name: "4등급", stars: 3.5, ceiling: 40, range: "23% 초과~40%" },
  { name: "5등급", stars: 3, ceiling: 60, range: "40% 초과~60%" },
  { name: "6등급", stars: 2.5, ceiling: 77, range: "60% 초과~77%" },
  { name: "7등급", stars: 2, ceiling: 89, range: "77% 초과~89%" },
  { name: "8등급", stars: 1.5, ceiling: 96, range: "89% 초과~96%" },
  { name: "9등급", stars: 1, ceiling: 100, range: "96% 초과~100%" },
] as const;
export const tierStars = (tier: TierName | null) => CONTRIBUTION_TIERS.find(t => t.name === tier)?.stars ?? 0;
export type TierName = typeof CONTRIBUTION_TIERS[number]["name"];
export type RelativeRow = { id: string; status: string; grade: string | null; school?: string | null; enrolledMonths: number | null;
  total: number | null; recent: number | null; partial: boolean };
type SourceRow = { family?: FamilyLoyalty; id: string; status: string; grade: string | null; school?: string | null; enrolledMonths: number | null;
  total: { raws: Raws; recent: Raws; unavailable: readonly string[] } | null };
export function relativeRows(rows: readonly SourceRow[], config: ContributionConfig): RelativeRow[] {
  return rows.map(r => ({ id: r.id, status: r.status, grade: r.grade, school: r.school ?? null, enrolledMonths: r.enrolledMonths,
    total: loyaltyTotal(r.total ? scoreRaws(r.total.raws, config).total : null, r.family, config),
    recent: r.total ? scoreRaws(r.total.recent, config).total : null, partial: !!r.total?.unavailable.length || !!r.family?.needsReview }));
}
export function tenureBand(months: number | null): string | null {
  if (months === null || !Number.isFinite(months) || months < 0) return null;
  return months < 3 ? "0~2개월" : months < 6 ? "3~5개월" : months < 12 ? "6~11개월" : months < 24 ? "12~23개월" : "24개월 이상";
}
export type RelativeResult = { scope: RelativeScope; metric: RelativeMetric; label: string; eligible: number; count: number;
  missing: number; partial: number; score: number | null; min: number | null; median: number | null; max: number | null;
  rank: number | null; ties: number; topPercent: number | null; position: number | null; tier: TierName | null; reason: string | null;
  /** 시안: 비슷한 학생 무리의 평균 — 막대 위에 '내 위치'와 함께 찍는다. 학생 수 2명 미만인 무리는 뺀다. */
  averages: { key: "grade" | "school" | "tenure" | "all"; label: string; value: number; count: number }[] };
const cents = (n: number) => Math.round(n * 100);

/** Fixed enrolled cohort. Top share = average tied rank / known cohort size; lower is better. */
export function relativeScore(rows: readonly RelativeRow[], studentId: string, metric: RelativeMetric = "total", scope: RelativeScope = "all"): RelativeResult {
  const student = rows.find(r => r.id === studentId), band = tenureBand(student?.enrolledMonths ?? null);
  const label = scope === "all" ? "전체 재원생" : scope === "grade" ? `같은 학년${student?.grade ? ` · ${student.grade}` : ""}` : `비슷한 재원기간${band ? ` · ${band}` : ""}`;
  const scopeMissing = scope === "grade" && !student?.grade || scope === "tenure" && !band;
  const cohort = scopeMissing ? [] : rows.filter(r => r.status === "enrolled"
    && (scope !== "grade" || r.grade === student?.grade) && (scope !== "tenure" || tenureBand(r.enrolledMonths) === band));
  const valid = cohort.filter(r => r[metric] !== null && Number.isFinite(r[metric]));
  const values = valid.map(r => cents(r[metric]!)).sort((a, b) => a - b), n = values.length;
  const score = student?.[metric] !== null && student?.[metric] !== undefined && Number.isFinite(student[metric]) ? cents(student[metric]!) / 100 : null;
  const result: RelativeResult = { scope, metric, label, eligible: cohort.length, count: n, missing: cohort.length - n,
    partial: valid.filter(r => r.partial).length, score, min: n ? values[0]! / 100 : null,
    median: n ? (values[Math.floor((n - 1) / 2)]! + values[Math.floor(n / 2)]!) / 200 : null,
    max: n ? values[n - 1]! / 100 : null, rank: null, ties: 0, topPercent: null, position: null, tier: null, reason: null, averages: cohortAverages(rows, student, metric) };
  if (!student || student.status !== "enrolled") return { ...result, reason: "현재 재원생만 상대평가합니다. 이 학생은 비교 대상에 포함되지 않습니다." };
  if (scopeMissing) return { ...result, reason: "비교에 필요한 학년 또는 재원기간이 아직 확인되지 않았습니다." };
  if (score === null || !n) return { ...result, reason: "집계된 점수가 없어 상대평가를 보류합니다." };
  const value = cents(score), less = values.filter(v => v < value).length, equal = values.filter(v => v === value).length;
  result.rank = n - less - equal + 1; result.ties = equal;
  result.position = result.max === result.min ? 50 : (score - result.min!) / (result.max! - result.min!) * 100;
  result.topPercent = n < 2 || result.min === result.max ? null : (result.rank + (equal - 1) / 2) / n * 100;
  if (n < 5) return { ...result, reason: "비교 인원이 5명 미만이어서 등급은 보류합니다." };
  if (result.min === result.max) return { ...result, reason: "비교 학생이 모두 동점이므로 등급을 나누지 않습니다." };
  result.tier = CONTRIBUTION_TIERS.find(t => result.topPercent! <= t.ceiling)!.name;
  return result;
}

/** 같은 학년 · 같은 학교 · 비슷한 재원기간 · 전체 재원생의 평균(본인 포함, 점수 있는 재원생만). */
function cohortAverages(rows: readonly RelativeRow[], student: RelativeRow | undefined, metric: RelativeMetric): RelativeResult["averages"] {
  if (!student) return [];
  const band = tenureBand(student.enrolledMonths);
  const groups: { key: RelativeResult["averages"][number]["key"]; label: string; keep: (r: RelativeRow) => boolean }[] = [
    ...(student.grade ? [{ key: "grade" as const, label: `같은 학년(${student.grade}) 평균`, keep: (r: RelativeRow) => r.grade === student.grade }] : []),
    ...(student.school ? [{ key: "school" as const, label: `같은 학교 평균`, keep: (r: RelativeRow) => r.school === student.school }] : []),
    ...(band ? [{ key: "tenure" as const, label: `비슷한 재원기간(${band}) 평균`, keep: (r: RelativeRow) => tenureBand(r.enrolledMonths) === band }] : []),
    { key: "all" as const, label: "전체 재원생 평균", keep: () => true },
  ];
  return groups.flatMap(g => {
    const vals = rows.filter(r => r.status === "enrolled" && g.keep(r)).map(r => r[metric]).filter((v): v is number => v !== null && Number.isFinite(v));
    return vals.length >= 2 ? [{ key: g.key, label: g.label, value: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100, count: vals.length }] : [];
  });
}

export function comparisonOptions(rows: readonly RelativeRow[], studentId: string) {
  return (["total", "recent"] as const).flatMap(metric => (["all", "grade", "tenure"] as const).map(scope => relativeScore(rows, studentId, metric, scope)));
}
