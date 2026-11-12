"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { freshSavedFilters } from "@/lib/filter-reset/server";
import { parseShuttleTodayPrefs, type ShuttleTodayPrefs } from "../today-prefs";
import { explainDbError } from "@/lib/supabase/db-error";
import { writeUiPrefsNs } from "@/lib/ui-prefs/write";

/**
 * `users.ui_prefs.shuttleToday`만 **필드 단위로** 갱신 — 오늘 등하원 화면의 보기 설정.
 *
 * ⚠️ 형제 키(`attendance`·`seatMonthly`·`ecs`·`timetable`…)는 반드시 보존한다 — 통째로 덮으면
 *    출석부 정렬 같은 남의 화면 설정이 조용히 날아간다(선례: seat/server/monthly-prefs).
 * ⚠️ 권한은 로그인만 본다 — 내 화면의 표시 취향이라 셔틀 기록 권한과 무관하다(열람 전용도 접을 수 있다).
 * ⚠️ `revalidatePath` 없음: 화면은 클라가 즉시 반영하고 이 저장은 **다음 방문용**이다.
 */
export async function saveShuttleTodayPrefs(
  next: Partial<ShuttleTodayPrefs>,
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
  if (readErr) return { ok: false, error: explainDbError(readErr, { scope: "shuttle.today.today-prefs.saveShuttleTodayPrefs", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};
  // 클라가 보낸 값을 그대로 믿지 않는다 — 파서를 한 번 태운다(모르는 값은 기본값으로 접힌다).
  const merged = parseShuttleTodayPrefs({ ...parseShuttleTodayPrefs(raw.shuttleToday), ...next });

  const { error } = await writeUiPrefsNs(admin, { userId: user.id, tenantId: user.tenantId }, "shuttleToday", { replace: merged });
  if (error) return { ok: false, error: explainDbError(error, { scope: "shuttle.today.today-prefs.saveShuttleTodayPrefs", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true };
}

/** 저장된 보기 설정 — 비로그인·미저장이면 기본값("all"). */
export async function loadShuttleTodayPrefs(): Promise<ShuttleTodayPrefs> {
  const user = await getCurrentUser();
  if (!user) return parseShuttleTodayPrefs(undefined);
  const admin = createAdminClient();
  const { data } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const raw = data?.ui_prefs as Record<string, unknown> | null | undefined;
  // 10분 넘게 안 본 화면이면 필터만 기본값으로(원장 2026-10-15 — src/lib/filter-reset/rules.ts).
  return freshSavedFilters("shuttleToday", parseShuttleTodayPrefs(raw?.shuttleToday), parseShuttleTodayPrefs(undefined));
}
