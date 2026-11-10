import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
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
import { familyBonus, familyRates } from "../model/family-loyalty";
import { relativeRows } from "../model/relative-score";
import { getContributionList } from "./queries";
import { scoreRaws } from "../model/calc";
import { loyaltyParts } from "../model/loyalty-parts";
import { manualRefreshDoneToday } from "./refresh-limit";
import { readMyUiPrefs } from "@/lib/ui-prefs/read";
import { PART_KEYS, type PartKey } from "../model/loyalty-parts";

export async function getLoyaltyRanking() {
  const [directory, snapshot, readable, user, list] = await Promise.all([getContributionDirectory(), getContributionSnapshot(), readableFactStudents(), getCurrentUser({ teacherView: true }), getContributionList(false)]);
  if (!directory || !snapshot || !user) return null;
  // Narrow before reads and before serialization, including the normalization cohort.
  const roster = directory.rows.filter(s => s.status === "enrolled" && (readable === null || readable.has(s.id)));
  const today = kstToday(), month = snapshot.refreshedAt ? kstToday(new Date(snapshot.refreshedAt)).slice(0, 7) : today.slice(0, 7);
  const [families, stored, attendanceAllowed, schoolAllowed, people, refreshedTodayAt, prefs] = await Promise.all([
    getFamilyLoyaltyDirectory(),
    fetchAllPagedInChunks<{ student_id: string; facts: RankingFacts | null }>(roster.map(s => s.id), (ids, a, b) => createAdminClient().from(MONTHS_TABLE)
      .select("student_id,facts:payload->loyaltyRanking").eq("tenant_id", directory.gate.tenantId).eq("month", month).in("student_id", ids).order("student_id").range(a, b).returns<{ student_id: string; facts: RankingFacts | null }[]>()),
    canAccessTenant(user.systemRole, "attendance"),
    canAccessTenant(user.systemRole, "exams"),
    // 시안: 가족 1등 표기('정채민 남매')의 재료 — 성별·생년월일만.
    fetchAllPaged<{ id: string; gender: string | null; birth_date: string | null }>((a, b) => createAdminClient().from("students")
      .select("id,gender,birth_date").eq("tenant_id", directory.gate.tenantId).order("id").range(a, b)).catch(() => []),
    manualRefreshDoneToday(directory.gate.tenantId).catch(() => null), // 표시용 — 누를 때(액션)가 다시 확인한다
    readMyUiPrefs(),
  ]);
  const savedCols = (prefs.loyaltyRanking as { columns?: unknown } | undefined)?.columns;
  const columnOrder: PartKey[] = Array.isArray(savedCols) && savedCols.length === PART_KEYS.length && PART_KEYS.every(k => savedCols.includes(k)) ? savedCols as PartKey[] : [...PART_KEYS];
  const person = new Map(people.map(p => [p.id, p]));
  const facts = new Map(stored.filter(r => r.facts?.version === 1 && r.facts.asOf <= today).map(r => [r.student_id, r.facts!]));
  const config = rankingConfig(snapshot.config);
  const rows = buildLoyaltyRanking(roster.map(s => {
    const original = facts.get(s.id) ?? null;
    // Strip denied raw fields too, not only their calculated points.
    const safe = original ? { ...original,
      ...(!attendanceAllowed ? { attendance: { scheduled: 0, recorded: 0, present: 0, late: 0, absent: 0, early: 0, rate: null } } : {}),
      ...(!schoolAllowed ? { school: { current: null, improvement: null, pairs: 0, subjects: 0, latest: null } } : {}) } : null;
    return { ...s, facts: safe, family: families.byStudent.get(s.id) ?? families.fallback, attendanceAllowed, schoolAllowed };
  }), config, {
    // 시안: 랭킹 점수 = 학생 상세와 같은 로열티 점수(활동 누적 + 가족 가점) 그대로 — 변환하지 않는다(원장 2026-11-09).
    totals: list ? new Map(relativeRows(list.rows, list.config).map(r => [r.id, r.total])) : undefined,
    familyPoints: list ? new Map(list.rows.map(r => [r.id, familyBonus(r.family, list.config)])) : undefined,
  });
  // 시안: 점수 칸 = 학생 상세 '총점 구성'과 같은 계산(누적 실적 × 현재 배점 · 가족 가점) — 칸의 합 = 종합 점수.
  const listById = new Map((list?.rows ?? []).map(r => [r.id, r]));
  const withParts = rows.map(r => { const l = listById.get(r.id);
    return { ...r, gender: person.get(r.id)?.gender ?? null, birthDate: person.get(r.id)?.birth_date ?? null, parts: loyaltyParts(l?.total && list ? scoreRaws(l.total.raws, list.config).points : null, l && list ? familyBonus(l.family, list.config) : null) }; });
  const familyRate = list ? familyRates(list.config) : null;
  return { rows: withParts, refreshedTodayAt, columnOrder, familyRate, config, canConfigure: directory.gate.canConfigure, canWrite: directory.gate.canWrite, today, refreshedAt: snapshot.refreshedAt,
    scoped: readable !== null, subjects: directory.subjects, missing: rows.filter(r => !r.facts).length };
}
export type LoyaltyRankingData = NonNullable<Awaited<ReturnType<typeof getLoyaltyRanking>>>;
