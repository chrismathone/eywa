"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { GRADE_SORT_DEFAULT, parseGradeSort, type GradeSort } from "../list-prefs";
import { explainDbError } from "@/lib/supabase/db-error";
import { writeUiPrefsNs } from "@/lib/ui-prefs/write";

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
  // 클라가 보낸 값을 그대로 믿지 않는다 — 파서를 한 번 태운다.
  const sort = parseGradeSort(next);
  // grades 안의 sort 키만 고친다 — 형제 키(다른 화면·grades의 다른 키)는 DB가 보존한다.
  const { error } = await writeUiPrefsNs(createAdminClient(), { userId: user.id, tenantId: user.tenantId }, "grades", { set: { sort } });
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
