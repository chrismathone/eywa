"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import {
  normalizeGradeSelection,
  serializeViewPrefs,
  type TimetableViewPrefs,
} from "../lib/view-prefs";

/**
 * 시간표 '뷰 설정'을 **본인 계정**에 저장한다(0146a users.ui_prefs).
 *
 * admin client + (id, tenant_id) 스코프 — RLS 우회지만 자기 행만 강제한다(0104a setMyNoticeMode와 동일 규약).
 *
 * ⚠️ ui_prefs는 화면별 네임스페이스라 **timetable 키만 갈아끼우고 형제 키는 보존**한다
 * (다른 화면 설정을 지우면 안 된다 — tenant_settings 섹션 머지와 같은 이유).
 *
 * ⚠️ 학년은 학원설정(operations.gradeLevels)이 단일 소스다. 저장 전에 설정과 교집합을 내고,
 * '전부 선택'은 null(필터 없음)로 정규화한다 — 사용자가 스스로를 빈 화면에 가두지 못하게.
 */
export async function saveTimetableViewPrefs(
  input: TimetableViewPrefs,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };

  const settings = await getTenantSettings();
  const allGrades = settings.operations.gradeLevels ?? [];
  const next: TimetableViewPrefs = {
    grades: normalizeGradeSelection(input.grades, allGrades),
    hideEmptyDays: typeof input.hideEmptyDays === "boolean" ? input.hideEmptyDays : null,
    collapseEmptyPeriods:
      typeof input.collapseEmptyPeriods === "boolean" ? input.collapseEmptyPeriods : null,
  };

  const admin = createAdminClient();
  // 형제 키 보존을 위해 현재값을 읽고 timetable만 교체한다.
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };

  const current =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};
  const timetable = serializeViewPrefs(next);
  const merged = { ...current };
  // 설정이 전부 기본값이면 키 자체를 지운다(빈 객체가 쌓이지 않게).
  if (Object.keys(timetable).length === 0) delete merged.timetable;
  else merged.timetable = timetable;

  const { error } = await admin
    .from("users")
    .update({ ui_prefs: merged })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/timetable");
  return { ok: true };
}
