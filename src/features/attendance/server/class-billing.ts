import "server-only";
import { requireAccess } from "@/lib/auth/require-access";
import { monthRange } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { loadVisibleClassAxisRows } from "./teacher-axis-queries";
import {
  attendanceClassBilledAmounts,
  attendanceClassConfirmedSessions,
  type AttendanceBillingTerm,
  type AttendanceInvoice,
  type AttendanceTermSessions,
} from "../class-billing";

/**
 * 빈 결과 — 두 칸 모두 빈 객체(열은 그대로 서고 값은 '미확정'으로 뜬다).
 * 🔴 **매번 새로 만든다** — 모듈 전역 하나를 돌려주면 호출부가 그 객체에 쓰는 순간 요청·테넌트를 넘어 샌다.
 */
const empty = () => ({ billed: {}, confirmedSessions: {} });

/** 강사에게는 출석부에 있는 학생×반의 청구액만 반환한다. 청구서 원문·학생 전체 금액은 서버에 둔다. */
export async function getAttendanceClassBilledAmounts(
  month: string,
  roster: readonly { classId: string; studentIds: readonly string[] }[],
): Promise<{ billed: Record<string, number>; confirmedSessions: Record<string, AttendanceTermSessions> }> {
  const user = await requireAccess("attendance");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || roster.length === 0) return empty();
  const { from, to } = monthRange(month);
  // 출석부와 동일한 권한·강사 축(요청 캐시). 표시용 번역 이름 대신 원래 반명으로 매칭한다.
  const visible = new Map((await loadVisibleClassAxisRows(from, to)).map((c) => [c.id, c.className]));
  const classes = roster.flatMap((c) => {
    const className = visible.get(c.classId);
    return className ? [{ ...c, className }] : [];
  });
  const studentIds = [...new Set(classes.flatMap((c) => c.studentIds))];
  if (studentIds.length === 0) return empty();

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
      // `quantity_basis`(0267a)·`pricing_mode`(0266a) = 확정값의 **단위**(옛 일수 기준 표식).
      // ⚠️ 둘 다 **이미 적용된** 컬럼이다([[#95]]) — 회차 확정 화면이 프로덕션에서 같은 두 칸을 읽고 있고,
      //    2026-09-17 읽기 전용 조회로도 확인했다(확정 630행 전부 `attendance_units`).
      .select("id, invoice_id, class_id, amount, confirmed_sessions, quantity_basis, pricing_mode, allocation_line_index, allocation_amount, allocation_source, allocation_base_amount")
      .eq("tenant_id", user.tenantId).in("invoice_id", chunk).order("id").range(f, t),
  );
  // 두 값은 **같은 조회**에서 나온다 — 청구액(배분 우선)과 등록 차수(확정 시수)가 서로 다른 재료를 보면
  // 한 줄에서 숫자가 어긋난다(원장 2026-09-17 '등록 차수' 열).
  return {
    billed: attendanceClassBilledAmounts(classes, invoices, terms),
    confirmedSessions: attendanceClassConfirmedSessions(classes, invoices, terms),
  };
}
