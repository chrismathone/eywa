import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { getContributionGate } from "./access";
import { readableFactStudents } from "./fact-access";
import { isMergedStudent } from "@/features/students/status/merged";
import { validateLiveSection, type LiveSection } from "@/features/students/ontology/live-contract";

export const getLiveContext = cache(async (studentId: string) => {
  if (!/^[a-f0-9-]{36}$/i.test(studentId)) return null;
  const gate = await getContributionGate();
  if (!gate) return null;
  const [user, readable, db] = await Promise.all([getCurrentUser({ teacherView: true }), readableFactStudents(), createClient()]);
  if (!user || (readable !== null && !readable.has(studentId))) return null;
  const [student, attendance, consultations, makeups] = await Promise.all([
    db.from("students").select("id, is_test, notes").eq("tenant_id", gate.tenantId).eq("id", studentId).maybeSingle(),
    canAccessTenant(user.systemRole, "attendance"), canAccessTenant(user.systemRole, "consultations"), canAccessTenant(user.systemRole, "makeups")]);
  if (student.error) throw student.error;
  if (!student.data || student.data.is_test || isMergedStudent(student.data.notes)) return null;
  return { db, tenant: gate.tenantId, studentId, today: kstToday(), checkedAt: new Date().toISOString(), readable, attendance, consultations, makeups, role: user.systemRole };
});
export type LiveContext = NonNullable<Awaited<ReturnType<typeof getLiveContext>>>;

export function unavailableSection(key: string, label: string, href: string, state: LiveSection["state"]): LiveSection {
  return { key, label, href, state, total: null, items: [] };
}
export async function readSection(key: string, label: string, href: string, read: () => Promise<LiveSection>): Promise<LiveSection> {
  try {
    const section = await read();
    const invalid = new Set(validateLiveSection(section).map((i) => i.itemId));
    return invalid.size ? { ...section, state: "partial", items: section.items.filter((i) => !invalid.has(i.id)), note: "근거 연결을 확인하지 못한 항목이 있습니다." } : section;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    const state = ["42P01", "42703", "PGRST204", "PGRST205"].includes(code) ? "schema_missing" : code === "42501" ? "forbidden" : "failed";
    console.error(`[student-ontology] ${key}`, code || "read_failed");
    return unavailableSection(key, label, href, state);
  }
}
