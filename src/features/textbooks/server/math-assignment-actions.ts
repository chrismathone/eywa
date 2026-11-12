"use server";

/**
 * 수학 교재 배정 쓰기 — 반 교재 / 학생 교재 한 자리씩.
 *
 * 🔴 게이트 = 수학 강사 시트와 **같은 함수**(`requireMcsClassAccess(write)`) — 목표를 적을 수 있는 사람이 교재도 건다
 *    ([[#77]] 화면 조건은 게이트가 아니다). 교재 마스터를 고치는 `textbooks` 권한과는 축이 다르다(영어 배정과 같은 결).
 * 🔴 "같은 교재" 확인은 **서버가 다시 판정한다** — 화면이 안 물어보고 보내도 `confirmed` 없이는 쓰지 않는다.
 * 🔴 admin(RLS 우회)이라 모든 쿼리에 `tenant_id` 명시 필터.
 * ⚠️ `"use server"` 파일은 async 함수만 export([[#119]]).
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { requireMcsClassAccess } from "@/features/math-sheets/server/access";
import { isModuleOnForTenant } from "@/features/owner/server/modules";
import { assignmentConflict, type AssignedBook, type AssignmentConflict } from "../math-assignment";

export type MathAssignResult =
  | { ok: true; unchanged?: boolean }
  | { ok: false; error: string }
  | { ok: false; conflict: AssignmentConflict };

const inputSchema = z.object({
  classId: z.string().uuid(),
  studentId: z.string().uuid().nullable(),
  /** null = 이 자리의 배정 해제(학생이면 반 교재로 돌아간다). */
  textbookId: z.string().uuid().nullable(),
  /** "같은 교재가 이미 있습니다 → 변경" 을 사람이 누른 뒤에만 true. */
  confirmed: z.boolean().optional(),
});

const NOT_READY = "수학 교재 배정 표가 아직 없습니다 — 마이그레이션(math_textbook_assignments)을 적용해 주세요";

export async function saveMathTextbookAssignment(input: z.input<typeof inputSchema>): Promise<MathAssignResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "배정할 교재를 다시 골라 주세요." };
  const { classId, studentId, textbookId, confirmed } = parsed.data;
  const gate = await requireMcsClassAccess(classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const { tenantId, user, className } = gate.access;
  if (!(await isModuleOnForTenant(tenantId, "textbooks"))) {
    return { ok: false, error: "이 학원은 교재목록 기능이 꺼져 있습니다" };
  }
  const admin = createAdminClient();

  const [bookRes, slotRes, enrRes] = await Promise.all([
    textbookId
      ? admin.from("textbooks").select("id, title").eq("tenant_id", tenantId).eq("id", textbookId)
          .eq("subject", "math").eq("is_active", true).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from("math_textbook_assignments")
      .select("id, student_id, textbook_id, textbooks!math_textbook_assignments_textbook_fkey(title)")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .or(studentId ? `student_id.is.null,student_id.eq.${studentId}` : "student_id.is.null"),
    studentId
      ? admin.from("enrollments").select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId).eq("class_id", classId).eq("student_id", studentId)
      : Promise.resolve({ count: 1, error: null }),
  ]);
  if (slotRes.error) {
    const missing = slotRes.error.code === "42P01" || slotRes.error.code === "PGRST205";
    return { ok: false, error: missing ? NOT_READY : "배정 상태를 확인하지 못했습니다. 다시 시도해 주세요." };
  }
  if (bookRes.error || enrRes.error) return { ok: false, error: "교재·수강 정보를 확인하지 못했습니다. 다시 시도해 주세요." };
  if (textbookId && !bookRes.data) return { ok: false, error: "교재목록에 없는 수학 교재입니다. 새로고침해 주세요." };
  if (!enrRes.count) return { ok: false, error: "이 반을 수강한 학생이 아닙니다. 새로고침해 주세요." };

  type SlotRow = { id: string; student_id: string | null; textbook_id: string; textbooks: { title: string } | null };
  const slots = (slotRes.data ?? []) as unknown as SlotRow[];
  const toBook = (r: SlotRow | undefined): AssignedBook | null =>
    r ? { textbookId: r.textbook_id, title: r.textbooks?.title ?? "" } : null;
  const classRow = slots.find((r) => r.student_id === null);
  const ownRow = studentId ? slots.find((r) => r.student_id === studentId) : classRow;

  const conflict = assignmentConflict({
    scope: studentId ? "student" : "class",
    textbookId,
    classBook: toBook(classRow),
    studentBook: studentId ? toBook(ownRow) : null,
  });
  if (conflict?.kind === "same-slot") return { ok: true, unchanged: true };
  if (conflict && !confirmed) return { ok: false, conflict };

  if (!textbookId) {
    if (!ownRow) return { ok: true, unchanged: true };
    const { error } = await admin.from("math_textbook_assignments").delete().eq("tenant_id", tenantId).eq("id", ownRow.id);
    if (error) return { ok: false, error: "배정을 해제하지 못했습니다. 다시 시도해 주세요." };
  } else if (ownRow) {
    const { error } = await admin.from("math_textbook_assignments")
      .update({ textbook_id: textbookId, updated_by: user.id })
      .eq("tenant_id", tenantId).eq("id", ownRow.id);
    if (error) return { ok: false, error: "교재를 바꾸지 못했습니다. 다시 시도해 주세요." };
  } else {
    const { error } = await admin.from("math_textbook_assignments").insert({
      tenant_id: tenantId, class_id: classId, student_id: studentId, textbook_id: textbookId,
      created_by: user.id, updated_by: user.id,
    });
    // 23505 = 같은 자리에 누가 먼저 걸었다(동시 저장) — 덮지 않고 새로고침을 권한다.
    if (error) {
      return { ok: false, error: error.code === "23505" ? "방금 다른 사람이 배정했습니다. 새로고침 후 다시 확인해 주세요." : "교재를 배정하지 못했습니다. 다시 시도해 주세요." };
    }
  }

  await logAction({
    action: "math_textbook_assign",
    targetType: "class",
    targetLabel: className,
    metadata: {
      classId,
      studentId,
      from: ownRow?.textbooks?.title ?? null,
      to: bookRes.data?.title ?? null,
    },
  });
  revalidatePath(`/mcs/${classId}/month`);
  revalidatePath("/textbooks");
  return { ok: true };
}
