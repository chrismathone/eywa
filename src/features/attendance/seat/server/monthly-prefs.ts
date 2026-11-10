"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { parseSeatMonthlyPrefs, type SeatMonthlyPrefs } from "../monthly-prefs";
import { explainDbError } from "@/lib/supabase/db-error";
import { writeUiPrefsNs } from "@/lib/ui-prefs/write";

/**
 * `users.ui_prefs.seatMonthly`만 필드 단위로 갱신.
 * ⚠️ `attendance`·ecs·timetable 등 형제 키는 보존한다 — 통째로 덮으면 출석부 정렬이 되돌아간다.
 */
export async function saveSeatMonthlyCollapsed(
  collapsed: string[],
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: explainDbError(readErr, { scope: "attendance.seat.monthly-prefs.saveSeatMonthlyCollapsed", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};
  const next: SeatMonthlyPrefs = parseSeatMonthlyPrefs({ collapsed });

  const { error } = await writeUiPrefsNs(admin, { userId: user.id, tenantId: user.tenantId }, "seatMonthly", { replace: { ...parseSeatMonthlyPrefs(raw.seatMonthly), ...next } });
  if (error) return { ok: false, error: explainDbError(error, { scope: "attendance.seat.monthly-prefs.saveSeatMonthlyCollapsed", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true };
}

export async function loadSeatMonthlyPrefs(): Promise<SeatMonthlyPrefs> {
  const user = await getCurrentUser();
  if (!user) return parseSeatMonthlyPrefs(undefined);
  const admin = createAdminClient();
  const { data } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const raw = data?.ui_prefs as Record<string, unknown> | null | undefined;
  return parseSeatMonthlyPrefs(raw?.seatMonthly);
}
