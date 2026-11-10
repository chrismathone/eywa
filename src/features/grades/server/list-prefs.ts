"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { GRADE_SORT_DEFAULT, parseGradeSort, type GradeSort } from "../list-prefs";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * `users.ui_prefs.grades`만 **필드 단위로** 갱신 — 성적관리 정렬(원장 2026-08-04 *"뷰 세팅은 계정 귀속"*).
 * 수업목록 `saveClassListPrefs`·학생목록과 같은 규약.
 *
 * ⚠️ 형제 키(`students`·`classes`…)는 반드시 보존한다 — 통째로 덮으면 남의 화면 설정이 날아간다.
 * ⚠️ 권한은 로그인만 본다 — 내 화면의 표시 취향이라 성적 쓰기 권한과 무관하다(열람만 되는 사람도 정렬은 기억한다).
 * ⚠️ `revalidatePath` 없음: 정렬은 **화면 안에서** 이미 끝났고 이 저장은 다음 방문용이다.
 */
export async function saveGradeSortPref(next: GradeSort): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: explainDbError(readErr, { scope: "grades.list-prefs.saveGradeSortPref", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};
  const prev =
    raw.grades && typeof raw.grades === "object" && !Array.isArray(raw.grades)
      ? (raw.grades as Record<string, unknown>)
      : {};
  // 클라가 보낸 값을 그대로 믿지 않는다 — 파서를 한 번 태운다.
  const sort = parseGradeSort(next);
  const { error } = await admin
    .from("users")
    .update({ ui_prefs: { ...raw, grades: { ...prev, sort } } })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: explainDbError(error, { scope: "grades.list-prefs.saveGradeSortPref", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true };
}

/**
 * 저장된 정렬 — 비로그인·미저장·조회 실패면 기본값(정렬 없음). 화면은 어떤 경우에도 뜬다.
 * 🔴 여기선 실패에 null을 돌리지 않는다(학생목록과 다른 점) — 정렬은 **화면 상태**라 `RememberPrefs`처럼
 *    "저장값과 비교해 되돌려 보내는" 경로가 없다. 못 읽으면 그냥 정렬 없이 시작한다.
 */
export async function loadGradeSortPref(): Promise<GradeSort> {
  const user = await getCurrentUser();
  if (!user) return GRADE_SORT_DEFAULT;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (error) return GRADE_SORT_DEFAULT;
  const raw = data?.ui_prefs as Record<string, unknown> | null | undefined;
  const grades =
    raw?.grades && typeof raw.grades === "object" && !Array.isArray(raw.grades)
      ? (raw.grades as Record<string, unknown>)
      : undefined;
  return parseGradeSort(grades?.sort);
}
