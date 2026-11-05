"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { validSessionQuantity } from "@/features/billing/session-pricing";
import type { SessionTermPatch } from "./actions";
import { SESSION_BILLING_OFF, sessionBillingOff } from "./module-gate";
import { humanizeDbError } from "@/lib/supabase/db-error";

/** 월 정액의 시수만 수정한다. 설정의 새 월 단가를 다시 적용하지 않는다. */
export async function updateMonthlyTermSessions(id: string, sessions: number, expectedConfirmedAt: string | null): Promise<{ error?: string; terms?: SessionTermPatch[] }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };
  if (!id || !expectedConfirmedAt || !validSessionQuantity(sessions)) return { error: "확정 시수는 0~99 사이, 소수 한 자리까지 입력하세요" };
  const db = await createClient();
  const { data, error } = await db.from("invoice_session_terms").update({ confirmed_sessions: sessions, quantity_basis: "attendance_units", confirmed_by: user.id, confirmed_at: new Date().toISOString() })
    .eq("id", id).eq("pricing_mode", "monthly").eq("confirmed_at", expectedConfirmedAt).not("confirmed_sessions", "is", null)
    .select("id, confirmed_sessions, unit_price, amount, confirmed_at").maybeSingle();
  if (error) return { error: humanizeDbError(error.message, "저장") };
  if (!data) return { error: "확정값이 변경되었습니다. 새로고침 후 다시 수정해 주세요" };
  after(async () => {
    revalidatePath("/billing");
    await logAction({ action: "session_term_monthly_units", targetType: "invoice_session_term", metadata: { termId: id, sessions, amountPreserved: data.amount, unitPricePreserved: data.unit_price } });
  });
  return { terms: [{ id: data.id, confirmedSessions: Number(data.confirmed_sessions), unitPrice: Number(data.unit_price), amount: Number(data.amount), confirmedAt: data.confirmed_at, pricingMode: "monthly", quantityBasis: "attendance_units" }] };
}
