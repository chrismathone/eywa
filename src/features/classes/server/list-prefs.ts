"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { freshSavedFilters } from "@/lib/filter-reset/server";
import { parseClassListPrefs, type ClassListPrefs } from "../list-prefs";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * `users.ui_prefs.classes`만 **필드 단위로** 갱신 — 수업목록 보기 설정(과목·담임·요일·정렬·보기).
 * 학생목록 `saveStudentListPrefs`·재고관리 `saveInventoryPrefs`와 같은 규약.
 *
 * ⚠️ 형제 키(`students`·`attendance`·`inventory`…)는 반드시 보존한다 — 통째로 덮으면 남의 화면 설정이 조용히 날아간다.
 * ⚠️ 권한은 로그인만 본다 — 내 화면의 표시 취향이라 수업 쓰기 권한과 무관하다(강사도 자기 필터를 기억한다).
 *    그래서 이 파일은 `actions.ts`가 아니다(그쪽 가드는 반 변경 액션에 관리 권한을 요구한다).
 * ⚠️ `revalidatePath` 없음: 화면은 URL이 이미 반영하고 이 저장은 **다음 방문용**이다.
 */
export async function saveClassListPrefs(next: Partial<ClassListPrefs>): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: explainDbError(readErr, { scope: "classes.list-prefs.saveClassListPrefs", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs) ? (row.ui_prefs as Record<string, unknown>) : {};
  // 클라가 보낸 값을 그대로 믿지 않는다 — 파서를 한 번 태운다.
  const merged = parseClassListPrefs({ ...parseClassListPrefs(raw.classes), ...next });
  const { error } = await admin
    .from("users")
    .update({ ui_prefs: { ...raw, classes: merged } })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: explainDbError(error, { scope: "classes.list-prefs.saveClassListPrefs", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true };
}

/**
 * 저장된 보기 설정 — 비로그인·미저장이면 기본값(목록은 그대로 뜬다, fail-soft).
 * 🔴 **조회 실패는 기본값이 아니라 null**(학생목록과 같은 규약, 리뷰 2026-09-04) — 기본값을 "저장값"으로 알면 RememberPrefs가 전체를 보내
 *    다른 축을 기본값으로 덮어쓴다. null이면 화면은 기본값으로 그리되 그 렌더는 저장하지 않는다.
 */
export async function loadClassListPrefs(): Promise<ClassListPrefs | null> {
  const user = await getCurrentUser();
  if (!user) return parseClassListPrefs(undefined);
  const admin = createAdminClient();
  const { data, error } = await admin.from("users").select("ui_prefs").eq("id", user.id).eq("tenant_id", user.tenantId).maybeSingle();
  if (error) return null;
  const raw = data?.ui_prefs as Record<string, unknown> | null | undefined;
  // 10분 넘게 안 본 화면이면 필터 키만 기본값으로(원장 2026-10-15 — src/lib/filter-reset/rules.ts). 정렬·보기는 그대로.
  return freshSavedFilters("classes", parseClassListPrefs(raw?.classes), parseClassListPrefs(undefined));
}
