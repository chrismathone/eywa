"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { canWriteClassRecord } from "@/features/classes/class-write-scope";
import {
  applyLevelChange,
  DEFAULT_ENGLISH_LEVELS,
  type LevelChange,
  type LevelDef,
} from "@/features/timetable/lib/level";

export type ChangeClassLevelState = { error?: string; newName?: string } | undefined;

/**
 * 영어 반 레벨업/다운 — 반이름 규칙(DP3→DP4 / DP3→PL1)에 따라 className만 변경.
 * aywa는 enrollments가 class_id(UUID)를 참조하므로 ijw처럼 enrollment.className 동기화가 불필요
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
    .select("id, class_name, subject, teacher_id")
    .eq("id", classId)
    .single();
  if (!klass) return { error: "반을 찾을 수 없습니다" };
  // scoped(강사)는 **담당 반만** — canWriteTenant는 "강사가 어떤 반이든 쓸 수 있다"만 보장하지 이 반이
  // 내 반인지는 보장하지 않는다. RLS도 tenant 격리뿐이라 여기서 막지 않으면 강사가 안 맡은 반 이름까지
  // 바꿀 수 있었다(2026-07-17 적대 감사 M4). full(관리자 계열·겸직 포함)은 기존대로 전 반.
  // 🔴 판정은 반 수정·위임과 **같은 순수 함수**(2026-09-04) — 손으로 복사한 네 번째 사본이었다.
  //    super_admin은 새 제한을 자동 통과(화면 버튼이 그렇게 나오므로 서버도 같아야 한다).
  if (
    !canWriteClassRecord({
      level: await accessLevelTenant(user.systemRole, "classes"),
      classTeacherId: (klass.teacher_id as string | null) ?? null,
      userId: user.id,
    }) &&
    !(await isCurrentUserSuperAdmin())
  ) {
    return { error: "담당 반만 변경할 수 있습니다" };
  }

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
