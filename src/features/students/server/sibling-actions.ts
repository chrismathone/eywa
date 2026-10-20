"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { isMergedStudent } from "../status/merged";
import { siblingHint, type SiblingOption } from "../siblings";

/**
 * 학생 수정 화면 형제 칸의 고르기 목록 — 칸을 **처음 열 때만** 부른다(수정 화면을 열 때마다 원생 전체를 읽지 않게).
 * 문 = 원생 정보 변경(학생 수정 저장과 같은 문 · 강사는 열람 전용). 퇴원생도 고를 수 있다(형제는 그만둔 뒤에도 형제).
 * 시험용·중복 병합된 원생과 자기 자신은 뺀다. 원생이 1,000명을 넘을 수 있어 `fetchAllPaged`(B2).
 */
export async function loadSiblingOptions(studentId: string): Promise<{ ok: true; options: SiblingOption[] } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canManageTenant(user.systemRole, "students"))) return { ok: false, error: "원생 정보 변경 권한이 없습니다" };
  try {
    const db = await createClient();
    const rows = await fetchAllPaged<{ id: string; name: string | null; school: string | null; grade: string | null; status: string; notes: string | null; is_test: boolean | null }>(
      (a, b) => db.from("students").select("id, name, school, grade, status, notes, is_test").eq("tenant_id", user.tenantId)
        .order("name").order("id").range(a, b),
    );
    return {
      ok: true,
      options: rows
        .filter((r) => r.id !== studentId && !r.is_test && !isMergedStudent(r.notes) && r.name?.trim())
        .map((r) => ({ value: r.id, label: (r.name ?? "").trim(), hint: siblingHint(r) })),
    };
  } catch (e) {
    console.error("[students/siblings] 고르기 목록 조회 실패", e instanceof Error ? e.message : e);
    return { ok: false, error: "목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
