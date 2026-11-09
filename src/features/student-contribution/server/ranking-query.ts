import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { getContributionDirectory, getContributionSnapshot } from "./directory";
import { getFamilyLoyaltyDirectory } from "./family-loyalty";
import { readableFactStudents } from "./fact-access";
import { MONTHS_TABLE } from "./store";
import type { RankingFacts } from "../model/ranking-facts";
import { buildLoyaltyRanking } from "../model/loyalty-ranking";
import { rankingConfig } from "../model/ranking-config";

export async function getLoyaltyRanking() {
  const [directory, snapshot, readable, user] = await Promise.all([getContributionDirectory(), getContributionSnapshot(), readableFactStudents(), getCurrentUser({ teacherView: true })]);
  if (!directory || !snapshot || !user) return null;
  // Narrow before reads and before serialization, including the normalization cohort.
  const roster = directory.rows.filter(s => s.status === "enrolled" && (readable === null || readable.has(s.id)));
  const today = kstToday(), month = snapshot.refreshedAt ? kstToday(new Date(snapshot.refreshedAt)).slice(0, 7) : today.slice(0, 7);
  const [families, stored, attendanceAllowed, schoolAllowed] = await Promise.all([
    getFamilyLoyaltyDirectory(),
    fetchAllPagedInChunks<{ student_id: string; facts: RankingFacts | null }>(roster.map(s => s.id), (ids, a, b) => createAdminClient().from(MONTHS_TABLE)
      .select("student_id,facts:payload->loyaltyRanking").eq("tenant_id", directory.gate.tenantId).eq("month", month).in("student_id", ids).order("student_id").range(a, b).returns<{ student_id: string; facts: RankingFacts | null }[]>()),
    canAccessTenant(user.systemRole, "attendance"),
    canAccessTenant(user.systemRole, "exams"),
  ]);
  const facts = new Map(stored.filter(r => r.facts?.version === 1 && r.facts.asOf <= today).map(r => [r.student_id, r.facts!]));
  const config = rankingConfig(snapshot.config);
  const rows = buildLoyaltyRanking(roster.map(s => {
    const original = facts.get(s.id) ?? null;
    // Strip denied raw fields too, not only their calculated points.
    const safe = original ? { ...original,
      ...(!attendanceAllowed ? { attendance: { scheduled: 0, recorded: 0, present: 0, late: 0, absent: 0, early: 0, rate: null } } : {}),
      ...(!schoolAllowed ? { school: { current: null, improvement: null, pairs: 0, subjects: 0, latest: null } } : {}) } : null;
    return { ...s, facts: safe, family: families.byStudent.get(s.id) ?? families.fallback, attendanceAllowed, schoolAllowed };
  }), config);
  return { rows, config, canConfigure: directory.gate.canConfigure, canWrite: directory.gate.canWrite, today, refreshedAt: snapshot.refreshedAt,
    scoped: readable !== null, subjects: directory.subjects, missing: rows.filter(r => !r.facts).length };
}
export type LoyaltyRankingData = NonNullable<Awaited<ReturnType<typeof getLoyaltyRanking>>>;
