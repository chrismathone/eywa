import { z } from "zod";
import { MAKEUP_ACTIONS, type MakeupAction, type MakeupCommandEnvelope } from "./types";

const uuid = z.string().uuid();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** 화면 명령. configure 는 학원 설정 저장이 보낸다. */
export const MAKEUP_UI_ACTIONS = [
  "intake", "approve", "deny", "assign", "reserve", "reschedule", "cancel",
  "participation", "submit", "verify", "reverse", "waive", "adjust", "hold",
  "resume", "close", "link_legacy", "resolve_reconciliation", "reconcile",
] as const;

export const makeupCommandSchema = z.object({
  command_id: uuid,
  action: z.enum(MAKEUP_UI_ACTIONS),
  payload: z.record(z.string(), z.unknown()),
  expected_revision: z.number().int().nonnegative().nullable(),
});

const envelope = z.object({
  command_id: uuid,
  action: z.enum(MAKEUP_ACTIONS),
  expected_revision: z.number().int().nullable(),
  payload: z.record(z.string(), z.unknown()),
});

function blank(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export const REVISION_REQUIRED = new Set<MakeupAction>([
  "approve", "deny", "assign", "hold", "resume", "close", "waive", "adjust",
  "reschedule", "cancel", "verify", "reverse", "resolve_reconciliation",
]);

function allocationsOk(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) return false;
  const seen = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object") return false;
    const item = row as Record<string, unknown>;
    const id = String(item.case_id ?? "");
    const minutes = item.minutes;
    if (blank(id) || seen.has(id) || !Number.isInteger(minutes) || Number(minutes) < 1 || Number(minutes) > 600) return false;
    seen.add(id);
  }
  return true;
}

function missingKeys(action: MakeupAction, payload: Record<string, unknown>): boolean {
  if (action === "intake") return ["student_id", "subject_key", "reason", "source_kind", "source_id"].some((k) => blank(payload[k]));
  if (action === "approve" || action === "deny" || action === "hold" || action === "resume") {
    return blank(payload.case_id) || ((action === "deny" || action === "hold") && blank(payload.reason));
  }
  if (action === "assign") {
    const unassign = Object.prototype.hasOwnProperty.call(payload, "owner_id");
    return blank(payload.case_id) || (!unassign && blank(payload.due_date));
  }
  if (action === "reserve") {
    const joined = !blank(payload.session_id);
    const created = !blank(payload.session_date) && !blank(payload.teacher_id) && !blank(payload.classroom_id)
      && Array.isArray(payload.period_ids) && payload.period_ids.length > 0;
    return blank(payload.student_id) || !allocationsOk(payload.allocations) || (!joined && !created);
  }
  if (action === "reschedule") return blank(payload.session_id) || blank(payload.session_date) || blank(payload.reason);
  if (action === "cancel") return blank(payload.reason) || (blank(payload.session_id) && blank(payload.participant_id));
  if (action === "participation") {
    const status = String(payload.status);
    const minutes = payload.actual_minutes;
    const minutesOk = Number.isInteger(minutes) && Number(minutes) >= 0 && Number(minutes) <= 600;
    const evidence = !blank(payload.report_id) || !blank(payload.learning_summary) || !blank(payload.attendance_record_id);
    const needsEvidence = status === "present" || status === "partial";
    return blank(payload.participant_id) || !["present", "partial", "no_show"].includes(status) || !minutesOk || (needsEvidence && !evidence);
  }
  if (action === "submit") return blank(payload.participant_id) || (blank(payload.report_id) && blank(payload.learning_summary));
  if (action === "verify") return blank(payload.fulfillment_id) || (payload.status !== "returned" && !Array.isArray(payload.recognitions));
  if (action === "reverse") return blank(payload.fulfillment_id) || blank(payload.reason);
  if (action === "waive") return blank(payload.case_id) || blank(payload.reason) || !Number.isInteger(payload.minutes);
  if (action === "adjust") return blank(payload.case_id) || blank(payload.reason) || (payload.minutes === undefined && blank(payload.due_date));
  if (action === "close") return blank(payload.case_id) || blank(payload.closure_reason);
  if (action === "link_legacy") return blank(payload.source_id);
  if (action === "resolve_reconciliation") return blank(payload.reconciliation_id) && blank(payload.projection_id);
  if (action === "reconcile") return blank(payload.reason);
  return blank(payload.mode);
}

function rejectBusiness(value: MakeupCommandEnvelope, ctx: z.RefinementCtx): void {
  const unit = value.payload.unit ?? value.payload.quantity_unit;
  if (unit !== undefined && unit !== "minutes") ctx.addIssue({ code: "custom", message: "첫 운영에서는 분 단위만 승인할 수 있습니다" });
  const cause = value.payload.cause ?? value.payload.reason;
  const key = value.payload.occurrence_key;
  const additional = cause === "additional" || (typeof key === "string" && key.startsWith("additional:"));
  if (additional && value.payload.original_date) ctx.addIssue({ code: "custom", message: "추가 지도에는 결석일을 넣지 않습니다" });
  if (value.action === "approve" && value.payload.target_minutes != null && (!Number.isInteger(value.payload.target_minutes) || Number(value.payload.target_minutes) < 0)) {
    ctx.addIssue({ code: "custom", message: "목표 분량이 올바르지 않습니다" });
  }
  if ((value.action === "reserve" || value.action === "reschedule") && value.payload.session_date != null && !ymd.safeParse(value.payload.session_date).success) {
    ctx.addIssue({ code: "custom", message: "예약 날짜가 올바르지 않습니다" });
  }
  if (value.action === "configure" && !["off", "on", "draining"].includes(String(value.payload.mode))) {
    ctx.addIssue({ code: "custom", message: "운영 상태가 올바르지 않습니다" });
  }
}

/** 명령 껍데기. 화면 스키마보다 필수 키가 엄격하고, 분량 규칙은 순수 함수가 한 번 더 본다. */
export function parseMakeupCommand(raw: unknown): { ok: true; value: MakeupCommandEnvelope } | { ok: false; error: string } {
  const parsed = envelope.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "보강 명령 형식이 올바르지 않습니다" };
  if (REVISION_REQUIRED.has(parsed.data.action) && parsed.data.expected_revision === null) {
    return { ok: false, error: "보강 명령에 필요한 값이 없습니다" };
  }
  if (missingKeys(parsed.data.action, parsed.data.payload)) return { ok: false, error: "보강 명령에 필요한 값이 없습니다" };
  const checked = envelope.superRefine(rejectBusiness).safeParse(parsed.data);
  if (!checked.success) return { ok: false, error: checked.error.issues[0]?.message ?? "보강 명령 형식이 올바르지 않습니다" };
  return { ok: true, value: checked.data };
}
