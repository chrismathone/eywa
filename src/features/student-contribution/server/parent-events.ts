import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { emptyParentEvents, type ParentEventSources } from "../model/parent-events/facts";
import { tableMissing } from "./store";

export async function hasApprovedParentEventImport(db: SupabaseClient, tenant: string) {
  const { data, error } = await db.from("student_parent_event_imports").select("id")
    .eq("tenant_id", tenant).eq("status", "applied").not("scoring_approved_at", "is", null).limit(1);
  if (tableMissing(error)) return false;
  if (error) throw new Error("설명회 자료의 승인 상태를 읽지 못했습니다");
  return !!data?.length;
}
const snapshot = z.object({ ready: z.boolean(), checkedAt: z.string().nullable(), coverageFrom: z.string().nullable().optional(), pendingRows: z.number().int().nonnegative().default(0), valid: z.boolean(), records: z.array(z.object({
  tenantId: z.string().uuid(), eventId: z.string().min(1), eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), title: z.string().min(1),
  studentId: z.string().uuid(), familyKey: z.string().regex(/^[a-f0-9]{64}$/), basis: z.enum(["direct", "household", "sibling"]),
  sourceIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1), attendanceBasis: z.enum(["explicit_attendance", "registration_policy"]),
})) });
/** One SQL snapshot: imports/cancellations cannot be mixed across separate HTTP reads. JSON aggregation has no REST row truncation. */
export async function loadParentEvents(db: SupabaseClient, tenant: string, scope?: { students?: string[]; month?: string }): Promise<ParentEventSources> {
  const { data, error } = await db.rpc("student_parent_event_snapshot", { p_tenant: tenant,
    ...(scope?.students ? { p_students: scope.students } : {}), ...(scope?.month ? { p_month: scope.month } : {}) });
  if (error?.code === "42883" || error?.code === "PGRST202" || tableMissing(error)) return emptyParentEvents();
  if (error) throw new Error("설명회 자료를 읽지 못했습니다");
  const result = snapshot.parse(data);
  if (!result.valid || result.records.some(r => r.tenantId !== tenant)) throw new Error("설명회 신청 근거의 연결을 확인해 주세요");
  return { ready: result.ready, checkedAt: result.checkedAt, coverageFrom: result.coverageFrom, pendingRows: result.pendingRows, records: result.records };
}
/** A source outage stops reconciliation, but must not hide the student's other records or frozen score. */
export async function loadParentEventsForDisplay(...args: Parameters<typeof loadParentEvents>): Promise<ParentEventSources> {
  try { return await loadParentEvents(...args); }
  catch { console.warn("[student-parent-events] display source unavailable", { tenant: args[1] }); return { ...emptyParentEvents(), readError: true }; }
}
