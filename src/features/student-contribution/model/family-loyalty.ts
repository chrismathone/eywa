import { siblingBasis, type SiblingPerson } from "@/features/students/siblings";
import type { ContributionConfig } from "./config";

export const DEFAULT_FAMILY_RATES = { enabled: true, two: 100, three: 250, fourPlus: 400 };
export const familyRates = (config: ContributionConfig) => config.family ?? DEFAULT_FAMILY_RATES;
export type FamilyMember = { id: string; name: string; active: boolean; basis: "self" | "phone" | "manual" };
export type FamilyLoyalty = { state: "ready" | "unavailable" | "restricted"; asOf: string;
  members: FamilyMember[]; activeCount: number | null; activeSiblings: number | null; needsReview: number; selfActive: boolean };
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
  const members: FamilyMember[] = [{ id: me.id, name: me.name, active: active(me), basis: "self" }];
  let needsReview = 0;
  for (const s of people.values()) {
    if (s.id === me.id || overrides.get(s.id) === false) continue;
    const basis = siblingBasis(me, s);
    if (overrides.get(s.id) === true || basis === "phone") members.push({ id: s.id, name: s.name, active: active(s), basis: overrides.get(s.id) ? "manual" : "phone" });
    else if (basis === "name" || basis === "conflict") needsReview++;
  }
  const activeSiblings = members.filter(m => m.id !== me.id && m.active).length;
  return { state: "ready", asOf, members, activeCount: members.filter(m => m.active).length, activeSiblings, needsReview, selfActive: active(me) };
}
export function familyBonus(family: FamilyLoyalty | null | undefined, config: ContributionConfig): number | null {
  const rates = familyRates(config);
  if (!rates.enabled) return 0;
  if (!family || family.state !== "ready") return null;
  if (!family.selfActive) return 0;
  return family.activeCount! >= 4 ? rates.fourPlus : family.activeCount === 3 ? rates.three : family.activeCount === 2 ? rates.two : 0;
}
export function loyaltyTotal(activity: number | null, family: FamilyLoyalty | null | undefined, config: ContributionConfig): number | null {
  const bonus = familyBonus(family, config);
  return activity === null || bonus === null ? null : Math.round((activity + bonus) * 100) / 100;
}
/** Precision index: the family factor alone contributes up to 40 / 100. */
export const familyFactorScore = (siblings: number) => siblings >= 3 ? 100 : siblings === 2 ? 87.5 : siblings === 1 ? 50 : 0;
