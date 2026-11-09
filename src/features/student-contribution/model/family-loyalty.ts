import { siblingBasis, type SiblingPerson } from "@/features/students/siblings";
import type { ContributionConfig } from "./config";

export const DEFAULT_FAMILY_RATES = { enabled: true, two: 100, three: 250, fourPlus: 400, perTogetherMonth: 2 };
export const familyRates = (config: ContributionConfig) => config.family ?? DEFAULT_FAMILY_RATES;
export type FamilyMember = { id: string; name: string; active: boolean; basis: "self" | "phone" | "manual"; months?: number | null };
/** 시안: 함께 재원 중인 형제의 재원기간 1개월마다 더하는 가족 가점(원장 2026-11-09 *"남매수도 많은데 재원기간까지 합산이 더 많으면 더 많은 점수"*). */
export const FAMILY_POINTS_PER_SIBLING_MONTH = 2;
export type FamilyLoyalty = { state: "ready" | "unavailable" | "restricted"; asOf: string;
  members: FamilyMember[]; activeCount: number | null; activeSiblings: number | null; needsReview: number; selfActive: boolean;
  /** 함께 재원 중인 형제(본인 제외)와 본인이 **겹쳐 다닌** 기간의 합(개월) — 형제마다 늦은 등록일부터 기준일까지. */
  siblingMonths?: number | null };
export type FamilyStudent = SiblingPerson & { name: string; status: string; enrolled_at: string | null; withdrawn_at: string | null };
export type FamilyLink = { student_a: string; student_b: string; linked: boolean };
export const unknownFamily = (asOf: string, state: "unavailable" | "restricted" = "unavailable"): FamilyLoyalty =>
  ({ state, asOf, members: [], activeCount: null, activeSiblings: null, needsReview: 0, selfActive: false });

/** Current status only. No transitive family merging and no monthly accumulation. */
export function buildFamilyLoyalty(studentId: string, students: readonly FamilyStudent[], links: readonly FamilyLink[], activeClassIds: ReadonlySet<string>, asOf: string): FamilyLoyalty {
  const people = new Map(students.map(s => [s.id, s])), me = people.get(studentId);
  if (!me) return unknownFamily(asOf);
  const overrides = new Map(links.flatMap(l => l.student_a === studentId ? [[l.student_b, l.linked] as const] : l.student_b === studentId ? [[l.student_a, l.linked] as const] : []));
  const active = (s: FamilyStudent) => s.status === "enrolled" && !!s.enrolled_at && s.enrolled_at <= asOf
    && (!s.withdrawn_at || s.withdrawn_at > asOf) && activeClassIds.has(s.id);
  // 재원기간 = 처음 등록일부터 기준일까지 달 수(휴원·공백은 빼지 않는 근사 — 학생 기록의 등록일 한 칸으로 셀 수 있다).
  const monthsOf = (s: FamilyStudent) => { if (!s.enrolled_at || s.enrolled_at > asOf) return null;
    const [y0, m0] = s.enrolled_at.slice(0, 7).split("-").map(Number), [y1, m1] = asOf.slice(0, 7).split("-").map(Number); return Math.max(1, (y1! - y0!) * 12 + (m1! - m0!) + 1); };
  const members: FamilyMember[] = [{ id: me.id, name: me.name, active: active(me), basis: "self", months: monthsOf(me) }];
  let needsReview = 0;
  for (const s of people.values()) {
    if (s.id === me.id || overrides.get(s.id) === false) continue;
    const basis = siblingBasis(me, s);
    if (overrides.get(s.id) === true || basis === "phone") members.push({ id: s.id, name: s.name, active: active(s), basis: overrides.get(s.id) ? "manual" : "phone", months: monthsOf(s) });
    else if (basis === "name" || basis === "conflict") needsReview++;
  }
  const activeSiblings = members.filter(m => m.id !== me.id && m.active).length;
  // 형제마다 '본인과 함께 다닌 기간'만 센다 = 둘 중 늦은 등록일부터 기준일까지(원장 2026-11-09 — A가 26.1, B가 26.5부터면 5월부터).
  const together = (s: FamilyStudent) => {
    if (!me.enrolled_at || !s.enrolled_at) return 0;
    const from = me.enrolled_at > s.enrolled_at ? me.enrolled_at : s.enrolled_at;
    return monthsOf({ ...s, enrolled_at: from }) ?? 0;
  };
  const siblingMonths = members.filter(m => m.id !== me.id && m.active).reduce((sum, m) => { const sib = people.get(m.id); return sum + (sib ? together(sib) : 0); }, 0);
  return { state: "ready", asOf, members, activeCount: members.filter(m => m.active).length, activeSiblings, needsReview, selfActive: active(me), siblingMonths };
}
export function familyBonus(family: FamilyLoyalty | null | undefined, config: ContributionConfig): number | null {
  const rates = familyRates(config);
  if (!rates.enabled) return 0;
  if (!family || family.state !== "ready") return null;
  if (!family.selfActive) return 0;
  const byCount = family.activeCount! >= 4 ? rates.fourPlus : family.activeCount === 3 ? rates.three : family.activeCount === 2 ? rates.two : 0;
  // 형제 수 기본 가점 + 함께 재원 중인 형제들의 재원기간 합 × 개월당 가점 — 형제가 많고 오래 다닐수록 더 받는다.
  return byCount > 0 ? byCount + (family.siblingMonths ?? 0) * (rates.perTogetherMonth ?? FAMILY_POINTS_PER_SIBLING_MONTH) : 0;
}
export function loyaltyTotal(activity: number | null, family: FamilyLoyalty | null | undefined, config: ContributionConfig): number | null {
  const bonus = familyBonus(family, config);
  return activity === null || bonus === null ? null : Math.round((activity + bonus) * 100) / 100;
}
/** Precision index: the family factor alone contributes up to 40 / 100. */
export const familyFactorScore = (siblings: number) => siblings >= 3 ? 100 : siblings === 2 ? 87.5 : siblings === 1 ? 50 : 0;
