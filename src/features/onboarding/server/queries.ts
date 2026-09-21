import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings, loadTenantSettingsRaw } from "@/features/owner/server/queries";
import { isGenericTenant } from "@/features/owner/preset";
import { onboardingSteps, type OnboardingStep } from "../steps";

/** 건수만(행을 받지 않는다, B2). 실패는 0 — 카드가 "아직 안 함"으로 보일 뿐 화면을 막지 않는다. */
async function headCount(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  try {
    const { count, error } = await query;
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

export type OnboardingCard = { steps: OnboardingStep[]; dismissed: boolean };

/**
 * 대시보드 '시작하기' 카드 재료 — **새 학원(일반판)의 원장**에게만. 그 외(침산 포함)는 null이라
 * 조회도 하지 않는다(침산 대시보드는 이 작업 전과 같은 조회·같은 화면).
 */
export async function getOnboardingCard(): Promise<OnboardingCard | null> {
  const user = await getCurrentUser();
  if (!user || user.systemRole !== "master") return null;
  const settings = await getTenantSettings();
  if (!isGenericTenant(settings)) return null;

  const supabase = await createClient();
  const t = user.tenantId;
  const head = { count: "exact" as const, head: true };
  const [raw, prefsRow, staff, classrooms, classes, schedules, students, enrollments, attendance, invoices] =
    await Promise.all([
      loadTenantSettingsRaw(t),
      supabase.from("users").select("ui_prefs").eq("id", user.id).maybeSingle(),
      headCount(supabase.from("users").select("*", head).eq("tenant_id", t).neq("system_role", "student")),
      headCount(supabase.from("classrooms").select("*", head).eq("tenant_id", t)),
      headCount(supabase.from("classes").select("*", head).eq("tenant_id", t)),
      headCount(supabase.from("class_schedules").select("*", head).eq("tenant_id", t)),
      headCount(supabase.from("students").select("*", head).eq("tenant_id", t)),
      headCount(supabase.from("enrollments").select("*", head).eq("tenant_id", t)),
      headCount(supabase.from("attendance_records").select("*", head).eq("tenant_id", t)),
      headCount(supabase.from("invoices").select("*", head).eq("tenant_id", t)),
    ]);
  const data = raw.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : {};
  const settingsSaved = "profile" in data || "operations" in data;
  const prefs = (prefsRow.data?.ui_prefs ?? {}) as Record<string, unknown>;
  const onboarding = (prefs.onboarding ?? {}) as { dismissed?: unknown };

  return {
    steps: onboardingSteps({ settingsSaved, staff, classrooms, classes, schedules, students, enrollments, attendance, invoices }),
    dismissed: onboarding.dismissed === true,
  };
}
