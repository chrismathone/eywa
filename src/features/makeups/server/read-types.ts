import { z } from "zod";

const id = z.string().uuid();
const nullableText = z.string().nullable();
const nullableMinutes = z.number().nonnegative().nullable();
const nullableBalance = z.number().int().nullable();
export const caseRowSchema = z.object({
  id, revision: z.number().int(), student_id: id, student_name: z.string(), subject_key: z.string(),
  original_class_id: id.nullable(), original_class_name: nullableText, original_date: nullableText,
  reason: z.string(), eligibility: z.enum(["pending", "approved", "denied"]),
  lifecycle: z.enum(["open", "on_hold", "closed"]), closure_reason: nullableText,
  target_minutes: nullableMinutes, outstanding_minutes: nullableBalance,
  committed_minutes: z.number().nonnegative(), reservable_minutes: nullableBalance,
  owner_id: id.nullable(), owner_name: nullableText, due_date: nullableText,
  next_session_date: nullableText, next_action: z.string(), flags: z.array(z.string()),
  imported_commitment: z.boolean(), updated_at: z.string(),
}).passthrough();
export type MakeupCaseRow = z.infer<typeof caseRowSchema>;

export const caseListSchema = z.object({
  mode: z.enum(["on", "draining"]), total: z.number().int().nonnegative(),
  page: z.number().int().positive(), page_size: z.number().int().positive(),
  rows: z.array(caseRowSchema), counts: z.record(z.string(), z.number().int().nonnegative()),
  last_success_at: z.string(),
});
export type MakeupCaseList = z.infer<typeof caseListSchema>;

export const sessionSchema = z.object({
  id, revision: z.number().int(), teacher_id: id.nullable(), classroom_id: id.nullable(),
  subject_key: z.string(), session_date: z.string(), start_time: z.string(), end_time: z.string(),
  period_ids: z.array(z.string()), capacity: z.number().int().nullable(), state: z.string(),
  class_id: id.nullable(),
  teacher_name: nullableText, classroom_name: nullableText, taken: z.number().int().nonnegative(),
}).passthrough();
export type MakeupSession = z.infer<typeof sessionSchema>;
export const participantSchema = z.object({
  id, revision: z.number().int(), session_id: id, student_id: id, status: z.string(),
  planned_minutes: z.number(), actual_minutes: nullableMinutes,
  attendance_record_id: id.nullable(),
}).passthrough();
export type MakeupParticipant = z.infer<typeof participantSchema>;
export const fulfillmentSchema = z.object({
  id, revision: z.number().int().positive(), participant_id: id, state: z.string(), actual_minutes: nullableMinutes,
  report_id: id.nullable(), attendance_record_id: id.nullable(),
  learning_summary: nullableText, homework: nullableText, return_reason: nullableText,
}).passthrough();
export type MakeupFulfillment = z.infer<typeof fulfillmentSchema>;
const record = z.record(z.string(), z.unknown());
const operationRecord = z.object({ id, revision: z.number().int().positive(), state: z.string() }).passthrough();
export const caseDetailSchema = z.object({
  case: caseRowSchema.extend({ note: nullableText, policy_version_id: id.nullable(),
    adjusted_minutes: z.number().int(), recognized_minutes: z.number().nonnegative(), waived_minutes: z.number().nonnegative(),
  }).passthrough(),
  policy: record.nullable(), quantities: record.nullable(),
  sources: z.array(record), sessions: z.array(sessionSchema), participants: z.array(participantSchema),
  allocations: z.array(record), fulfillments: z.array(fulfillmentSchema),
  recognitions: z.array(record), adjustments: z.array(record), events: z.array(record),
  reconciliation: z.array(operationRecord), projection_jobs: z.array(operationRecord), legacy_maps: z.array(record),
  permissions: z.record(z.string(), z.boolean()),
});
export type MakeupCaseDetail = z.infer<typeof caseDetailSchema>;

export const optionPageSchema = z.object({
  rows: z.array(z.object({ id, name: z.string() }).passthrough()),
  total: z.number().int().nonnegative(), page: z.number().int(), page_size: z.number().int(),
});
export type MakeupOption = z.infer<typeof optionPageSchema>["rows"][number];
export const candidatePageSchema = z.object({
  rows: z.array(z.object({ id, student_id: id, student_name: z.string(), class_id: id,
    class_name: z.string(), subject_key: z.string(), original_date: z.string(),
    session_date: z.string().optional(), status: z.string() }).passthrough()),
  total: z.number().int().nonnegative(), page: z.number().int(), page_size: z.number().int(),
});
export type MakeupCandidate = z.infer<typeof candidatePageSchema>["rows"][number];
export const dryRunPageSchema = candidatePageSchema.extend({
  page: z.number().int().positive(), page_size: z.number().int().min(1).max(200),
  rows: z.array(candidatePageSchema.shape.rows.element.extend({
    source_hash: z.string().regex(/^[a-f0-9]{32}$/), occurrence_key: z.string().min(1),
    evidence_grade: z.enum(["A", "B", "C", "D", "E"]),
    duplicate_count: z.number().int().nonnegative(), review_note: z.string(),
  })),
  counts: z.object({ A: z.number().int().nonnegative(), B: z.number().int().nonnegative(),
    C: z.number().int().nonnegative(), D: z.number().int().nonnegative(), E: z.number().int().nonnegative() }),
  writes: z.literal(0),
}).refine(data => Object.values(data.counts).reduce((sum, count) => sum + count, 0) === data.total
  && data.rows.length <= data.page_size, "사전 점검 집계가 일치하지 않습니다");
export type ReadResult<T> = { data: T; error?: never } | { data?: never; error: string };
export const eventPageSchema = z.object({
  rows: z.array(z.object({ id, event_type: z.string(), actor_name: nullableText,
    reason: nullableText, occurred_at: z.string() }).passthrough()),
  total: z.number().int().nonnegative(), page: z.number().int().positive(), page_size: z.number().int().positive(),
});
export type MakeupEventPage = z.infer<typeof eventPageSchema>;

export const reconciliationPageSchema = z.object({
  rows: z.array(operationRecord), total: z.number().int().nonnegative(),
  page: z.number().int().positive(), page_size: z.number().int().positive(),
  projection_jobs: z.array(operationRecord), projection_total: z.number().int().nonnegative(),
  projection_pending: z.number().int().nonnegative(), projection_failed: z.number().int().nonnegative(),
  projection_page: z.number().int().positive(), projection_page_size: z.number().int().positive(),
  last_success_at: z.string(), last_run: record.nullable(),
  permissions: z.record(z.string(), z.boolean()),
});
export type MakeupReconciliationPage = z.infer<typeof reconciliationPageSchema>;
