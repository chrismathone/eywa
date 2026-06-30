"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import {
  applyLevelChange,
  DEFAULT_ENGLISH_LEVELS,
  type LevelChange,
  type LevelDef,
} from "@/features/timetable/lib/level";

export type ChangeClassLevelState = { error?: string; newName?: string } | undefined;

/**
 * 영어 반 레벨업/다운 — 반이름 규칙(DP3→DP4 / DP3→PL1)에 따라 className만 변경.
 * eywa는 enrollments가 class_id(UUID)를 참조하므로 ijw처럼 enrollment.className 동기화가 불필요
 * (반이동 흔적 없이 깔끔히 rename). 레벨 순서는 테넌트 english_levels, 없으면 기본 12레벨.
 */
export async function changeClassLevel(
  classId: string,
  change: LevelChange,
): Promise<ChangeClassLevelState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "classes"))) return { error: "반 관리 권한이 없습니다" };
  if (!classId) return { error: "반 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: klass } = await supabase
    .from("classes")
    .select("id, class_name, subject")
    .eq("id", classId)
    .single();
  if (!klass) return { error: "반을 찾을 수 없습니다" };

  const { data: levelRows } = await supabase
    .from("english_levels")
    .select("abbreviation, full_name")
    .order("sort_order");
  const order: LevelDef[] =
    levelRows && levelRows.length > 0
      ? levelRows.map((l) => ({ abbreviation: l.abbreviation, fullName: l.full_name ?? "" }))
      : DEFAULT_ENGLISH_LEVELS;

  const newName = applyLevelChange(klass.class_name, change, order);
  if (!newName) return { error: "이 반은 레벨 규칙(예: DP3)이 아니거나 더 올릴/내릴 수 없습니다" };

  const { error } = await supabase
    .from("classes")
    .update({ class_name: newName })
    .eq("id", classId);
  if (error) {
    if (error.message?.includes("classes_tenant_name_subject")) {
      return { error: `이미 "${newName}" 반이 있습니다` };
    }
    return { error: error.message };
  }

  revalidatePath("/timetable");
  revalidatePath(`/classes/${classId}`);
  return { newName };
}
