"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { parseStudentListPrefs, type StudentListPrefs } from "../list-prefs";

/**
 * `users.ui_prefs.students`만 **필드 단위로** 갱신 — 학생목록 보기 설정(과목·학년·담임·검색 필드·정렬·미수강 제외).
 * 재고관리 `saveInventoryPrefs`와 같은 규약(2026-09-02).
 *
 * ⚠️ 형제 키(`attendance`·`inventory`·`ecs`…)는 반드시 보존한다 — 통째로 덮으면 남의 화면 설정이 조용히 날아간다.
 * ⚠️ 권한은 로그인만 본다 — 내 화면의 표시 취향이라 학생 쓰기 권한과 무관하다(강사도 자기 필터를 기억한다).
 *    그래서 이 파일은 `actions.ts`가 아니다(그쪽 가드는 학생 변경 액션에 canManageStudentRecords를 요구한다).
 * ⚠️ `revalidatePath` 없음: 화면은 URL이 이미 반영하고 이 저장은 **다음 방문용**이다.
 */
export async function saveStudentListPrefs(next: Partial<StudentListPrefs>): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs) ? (row.ui_prefs as Record<string, unknown>) : {};
  // 클라가 보낸 값을 그대로 믿지 않는다 — 파서를 한 번 태운다.
  const merged = parseStudentListPrefs({ ...parseStudentListPrefs(raw.students), ...next });
  const { error } = await admin
    .from("users")
    .update({ ui_prefs: { ...raw, students: merged } })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** 저장된 보기 설정 — 비로그인·미저장·조회 실패면 기본값(목록은 그대로 뜬다, fail-soft). */
export async function loadStudentListPrefs(): Promise<StudentListPrefs> {
  const user = await getCurrentUser();
  if (!user) return parseStudentListPrefs(undefined);
  const admin = createAdminClient();
  const { data } = await admin.from("users").select("ui_prefs").eq("id", user.id).eq("tenant_id", user.tenantId).maybeSingle();
  const raw = data?.ui_prefs as Record<string, unknown> | null | undefined;
  return parseStudentListPrefs(raw?.students);
}
