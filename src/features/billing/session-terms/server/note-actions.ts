"use server";

import { SESSION_BILLING_OFF, sessionBillingOff } from "./module-gate";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { normalizeTermNote, TERM_NOTE_MAX } from "../term-note";
import { isVirtualTermId } from "../month-roster";
import { logDbError } from "@/lib/supabase/db-error";

/**
 * 회차 확정 표의 메모(특이사항) 저장 — 원장 2026-09-17 *"메모(특이사항) … 없는 건 추가"*.
 *
 * 칸은 0102a부터 있던 `invoice_session_terms.note`(그동안 아무도 안 썼다 — 실측 1,969행 전부 null).
 * 🔴 메모만 쓴다 — 확정값·배분 필드를 건드리지 않으므로 청구 금액·배분·분배는 안 변한다.
 * 게이트는 확정·해제와 같은 문(`canWriteTenant("billing")`), 누가·무엇으로 고쳤는지는 감사로그에 남는다
 * (행에는 마지막 값만 남는다).
 */
export async function updateSessionTermNote(id: string, raw: string): Promise<{ error?: string; note?: string | null }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };
  if (!id) return { error: "대상이 없습니다" };
  // 회차 행이 없는 줄(가상 id) — 메모를 적을 행이 아직 없다(화면도 그 칸을 잠근다). uuid 열에 그대로 보내지 않는다.
  if (isVirtualTermId(id)) return { error: "아직 회차 행이 없는 줄입니다 — 시수를 확정하거나 수납을 배분하면 메모를 적을 수 있습니다" };
  const note = normalizeTermNote(raw);
  if (note !== null && note.length > TERM_NOTE_MAX) return { error: `메모는 ${TERM_NOTE_MAX}자까지 적을 수 있습니다` };

  const db = await createClient();
  const { data: before, error: readError } = await db
    .from("invoice_session_terms")
    .select("class_id, note, invoice:invoice_id ( student_id )")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    logDbError(readError, "billing.session-terms.updateSessionTermNote");
    return { error: "메모를 저장하지 못했습니다. 다시 시도해 주세요" };
  }
  if (!before) return { error: "대상을 찾을 수 없습니다" };
  const noteBefore = normalizeTermNote(before.note ?? "");
  if (noteBefore === note) return { note };

  const { data: saved, error } = await db.from("invoice_session_terms").update({ note }).eq("id", id).select("id").maybeSingle();
  if (error) {
    logDbError(error, "billing.session-terms.updateSessionTermNote");
    return { error: "메모를 저장하지 못했습니다. 다시 시도해 주세요" };
  }
  if (!saved) return { error: "저장할 대상을 찾을 수 없습니다" };

  const invoice = Array.isArray(before.invoice) ? before.invoice[0] : before.invoice;
  after(async () => {
    revalidatePath("/billing");
    await logAction({
      action: "session_term_note",
      targetType: "invoice_session_term",
      metadata: { termId: id, studentId: invoice?.student_id ?? null, classId: before.class_id ?? null, note, noteBefore },
    });
  });
  return { note };
}
