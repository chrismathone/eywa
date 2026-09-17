import "server-only";
import { requireAccess } from "@/lib/auth/require-access";
import { monthRange } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { loadVisibleClassAxisRows } from "./teacher-axis-queries";
import {
  attendanceClassBilledAmounts,
  type AttendanceBillingTerm,
  type AttendanceInvoice,
} from "../class-billing";

/** 강사에게는 출석부에 있는 학생×반의 청구액만 반환한다. 청구서 원문·학생 전체 금액은 서버에 둔다. */
export async function getAttendanceClassBilledAmounts(
  month: string,
  roster: readonly { classId: string; studentIds: readonly string[] }[],
): Promise<Record<string, number>> {
  const user = await requireAccess("attendance");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || roster.length === 0) return {};
  const { from, to } = monthRange(month);
  // 출석부와 동일한 권한·강사 축(요청 캐시). 표시용 번역 이름 대신 원래 반명으로 매칭한다.
  const visible = new Map((await loadVisibleClassAxisRows(from, to)).map((c) => [c.id, c.className]));
  const classes = roster.flatMap((c) => {
    const className = visible.get(c.classId);
    return className ? [{ ...c, className }] : [];
  });
  const studentIds = [...new Set(classes.flatMap((c) => c.studentIds))];
  if (studentIds.length === 0) return {};

  // invoices의 원문은 강사 RLS로 차단되어 있다. 인증·반 스코프 검증 후 테넌트/학생/월로 한정한다.
  const admin = createAdminClient();
  const invoices = await fetchAllPagedInChunks<AttendanceInvoice>(studentIds, (chunk, f, t) =>
    admin.from("invoices").select("id, student_id, line_items")
      .eq("tenant_id", user.tenantId).eq("period", month).neq("status", "void")
      .in("student_id", chunk).order("id").range(f, t),
  );
  // 배분 유효성은 청구서 전체 반이 필요하다. 최종 결과는 classes의 학생×반으로만 좁힌다.
  const terms = await fetchAllPagedInChunks<AttendanceBillingTerm>(invoices.map((i) => i.id), (chunk, f, t) =>
    admin.from("invoice_session_terms")
      .select("id, invoice_id, class_id, amount, confirmed_sessions, allocation_line_index, allocation_amount, allocation_source, allocation_base_amount")
      .eq("tenant_id", user.tenantId).in("invoice_id", chunk).order("id").range(f, t),
  );
  return attendanceClassBilledAmounts(classes, invoices, terms);
}
