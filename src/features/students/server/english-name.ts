"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canAccessTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { saveEnglishName } from "./english-name-store";
import { addDays, kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { READ_GRACE_DAYS, teacherClassScopeStrict } from "./read-scope";

const inputSchema = z.object({
  studentId: z.uuid(),
  englishName: z.string().trim().max(80).refine((s) => !/[\u0000-\u001f\u007f]/.test(s)),
  previousEnglishName: z.string().max(1000).nullable(),
});

export type EnglishNameResult =
  | { ok: true; englishName: string | null }
  | { ok: false; error: "invalid" | "denied" | "missing" | "conflict" | "duplicate" | "failed" };

/** 영문 이름 한 칸만 수정한다. 인증·담당 범위·지점을 확인한 뒤 저장한다. */
export async function updateStudentEnglishName(input: {
  studentId: string;
  englishName: string;
  previousEnglishName: string | null;
}): Promise<EnglishNameResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const user = await getCurrentUser();
  if (!user || user.systemRole === "student") return { ok: false, error: "denied" };
  const [level, canRead] = await Promise.all([
    accessLevelTenant(user.systemRole, "student_english_name"),
    canAccessTenant(user.systemRole, "ecs"),
  ]);
  // 다른 강사 뷰도 accessLevelTenant에서 readonly로 내려간다.
  if ((level !== "full" && level !== "scoped") || !canRead) return { ok: false, error: "denied" };
  const { studentId, previousEnglishName } = parsed.data;
  const englishName = parsed.data.englishName || null;
  try {
    const session = await createClient();
    // 실제 강사는 전용 권한이 '전체'여도 담당 학생 범위를 지킨다. 조회 실패는 쓰기를 허용하지 않는다.
    if (user.systemRole === "teacher" || level === "scoped") {
      const scope = await teacherClassScopeStrict(user.id);
      const classIds = [...new Set([...scope.own, ...scope.slots.map((s) => s.classId), ...scope.delegated])];
      let inScope = false;
      for (let i = 0; i < classIds.length; i += 100) {
        const { count, error } = await session.from("enrollments")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", user.tenantId).eq("student_id", studentId)
          .in("class_id", classIds.slice(i, i + 100))
          .or(`end_date.is.null,end_date.gte.${addDays(kstToday(), -READ_GRACE_DAYS)}`);
        if (error) return { ok: false, error: "failed" };
        if ((count ?? 0) > 0) { inScope = true; break; }
      }
      if (!inScope) return { ok: false, error: "denied" };
    }
    const { data: student, error: readError } = await session.from("students")
      .select("id, name, english_name").eq("tenant_id", user.tenantId).eq("id", studentId).maybeSingle();
    if (readError) return { ok: false, error: "failed" };
    if (!student) return { ok: false, error: "missing" };
    if (student.english_name !== previousEnglishName) return { ok: false, error: "conflict" };
    if (student.english_name === englishName) return { ok: true, englishName };

    // 권한·담당 범위를 확인한 뒤 지점 전체 중복 검사와 한 필드 저장을 같은 트랜잭션으로 처리한다.
    const result = await saveEnglishName({ tenantId: user.tenantId, studentId, englishName, previousEnglishName });
    if (result !== "saved") return { ok: false, error: result };
    await logAction({ action: "student_english_name_update", targetType: "student", targetLabel: student.name,
      metadata: { studentId, before: previousEnglishName, after: englishName } });
    revalidatePath("/ecs", "layout");
    revalidatePath(`/students/${studentId}`);
    return { ok: true, englishName };
  } catch {
    return { ok: false, error: "failed" };
  }
}
