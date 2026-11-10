"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { freshSavedFilters } from "@/lib/filter-reset/server";
import { parseSchoolStatsPrefs, type SchoolStatsPrefs } from "../school-view-prefs";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * 학교별 점유율 보기 설정을 **본인 계정**에 저장 — `users.ui_prefs.enrollmentStats`.
 *
 * 원장 지시(2026-08-04, 상시): 모든 뷰 세팅은 계정 귀속. localStorage는 포트까지 포함한 origin
 * 단위라 "로그인은 그대로인데 설정만 리셋"으로 위장한다(gotcha #90).
 *
 * ⚠️ ui_prefs는 화면별 네임스페이스다 — `enrollmentStats` 키만 갈아끼우고 **형제 키(ecs·timetable·
 * onescreen)는 보존**한다. 통째로 덮으면 다른 화면 설정이 조용히 날아간다.
 * ⚠️ 권한은 로그인만 본다 — 내 계정의 표시 취향이라 등록상담 쓰기 권한과 무관하다.
 * ⚠️ `revalidatePath` 없음: 정렬·필터는 클라 state가 즉시 반영하고 이 저장은 다음 방문용이다.
 *    되살리면 값을 바꿀 때마다 화면이 다시 그려져 오히려 느려진다.
 */
export async function saveSchoolStatsPrefs(
  next: SchoolStatsPrefs,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };

  // 클라가 보낸 값을 그대로 믿지 않는다 — 파서를 한 번 태워 알 수 없는 값은 기본값으로 되돌린다.
  const safe = parseSchoolStatsPrefs(next);

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: explainDbError(readErr, { scope: "enrollment.school-prefs-actions.saveSchoolStatsPrefs", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};

  const { error } = await admin
    .from("users")
    .update({ ui_prefs: { ...raw, enrollmentStats: safe } })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: explainDbError(error, { scope: "enrollment.school-prefs-actions.saveSchoolStatsPrefs", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true };
}

/** 저장된 설정 읽기 — 없거나 깨졌으면 기본값(파서가 흡수). */
export async function loadSchoolStatsPrefs(): Promise<SchoolStatsPrefs> {
  const user = await getCurrentUser();
  if (!user) return parseSchoolStatsPrefs(undefined);
  const admin = createAdminClient();
  const { data } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const raw = data?.ui_prefs as Record<string, unknown> | null | undefined;
  // 10분 넘게 안 본 화면이면 필터만 기본값으로(원장 2026-10-15 — src/lib/filter-reset/rules.ts).
  return freshSavedFilters("enrollmentStats", parseSchoolStatsPrefs(raw?.enrollmentStats), parseSchoolStatsPrefs(undefined));
}
