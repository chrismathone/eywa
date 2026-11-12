"use server";

/**
 * 교재 전체 목표 — 목표 권 고르기/자동으로 되돌리기(원장 2026-10-20 *"최종목표가 설정되면 수정되게도 교재단위로"*).
 *
 * 🔴 게이트 = 교재 배정·전체 목표와 **같은 함수**(`requireMcsClassAccess(write)`, [[#77]]) + 그 반 수강생인지.
 * 🔴 열쇠 모양을 서버가 다시 본다(`parseKey`) — 시리즈가 열쇠와 다르면 거절.
 * 🔴 admin(RLS 우회)이라 모든 쿼리에 `tenant_id` 명시 필터. ⚠️ `"use server"` 파일은 async 함수만 export([[#119]]).
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { requireMcsClassAccess } from "@/features/math-sheets/server/access";
import { isModuleOnForTenant } from "@/features/owner/server/modules";
import { parseKey } from "../book-sequence";

const inputSchema = z.object({
  classId: z.string().uuid(),
  studentId: z.string().uuid(),
  series: z.string().min(1).max(40),
  /** null = 자동 목표로 되돌리기. */
  targetKey: z.string().min(1).max(80).nullable(),
});

const NOT_READY = "목표 교재 저장 표가 아직 없습니다 — 마이그레이션(math_book_targets)을 적용해 주세요";

export async function saveMathBookTarget(input: z.input<typeof inputSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "목표 교재를 다시 골라 주세요." };
  const { classId, studentId, series, targetKey } = parsed.data;
  if (targetKey && parseKey(targetKey)?.series !== series) return { ok: false, error: "목표 교재를 다시 골라 주세요." };
  const gate = await requireMcsClassAccess(classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const { tenantId, user, className } = gate.access;
  if (!(await isModuleOnForTenant(tenantId, "textbooks"))) {
    return { ok: false, error: "이 학원은 교재목록 기능이 꺼져 있습니다" };
  }
  const admin = createAdminClient();

  const enr = await admin.from("enrollments").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("class_id", classId).eq("student_id", studentId);
  if (enr.error) return { ok: false, error: "수강 정보를 확인하지 못했습니다. 다시 시도해 주세요." };
  if (!enr.count) return { ok: false, error: "이 반을 수강한 학생이 아닙니다. 새로고침해 주세요." };

  const res = targetKey
    ? await admin.from("math_book_targets").upsert(
      { tenant_id: tenantId, student_id: studentId, series, target_key: targetKey, updated_by: user.id },
      { onConflict: "tenant_id,student_id,series" },
    )
    : await admin.from("math_book_targets").delete().eq("tenant_id", tenantId).eq("student_id", studentId).eq("series", series);
  if (res.error) {
    const missing = res.error.code === "42P01" || res.error.code === "PGRST205";
    return { ok: false, error: missing ? NOT_READY : "목표 교재를 저장하지 못했습니다. 다시 시도해 주세요." };
  }

  await logAction({
    action: "math_book_target",
    targetType: "class",
    targetLabel: className,
    metadata: { classId, studentId, series, targetKey },
  });
  revalidatePath(`/mcs/${classId}/month`);
  return { ok: true };
}
