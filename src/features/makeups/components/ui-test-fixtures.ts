import type { MakeupCaseDetail, MakeupCaseRow, MakeupFulfillment, MakeupParticipant, MakeupSession } from "../server/read-types";
import type { PeriodsConfig } from "@/features/timetable/lib/periods";

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const periods = { weekdays: {}, weekends: [] } as unknown as PeriodsConfig;
export const caseRow = (values: Partial<MakeupCaseRow> = {}): MakeupCaseRow => ({
  id: uuid(1), revision: 1, student_id: uuid(2), student_name: "학생", subject_key: "mathematics",
  original_class_id: uuid(3), original_class_name: "수학반", original_date: "2026-10-01",
  reason: "absence", eligibility: "approved", lifecycle: "open", closure_reason: null,
  target_minutes: 180, outstanding_minutes: 180, committed_minutes: 0, reservable_minutes: 180,
  owner_id: uuid(4), owner_name: "강사", due_date: "2026-10-31", next_session_date: null,
  next_action: "schedule", flags: [], imported_commitment: false, updated_at: "2026-10-05", ...values,
});
export const session = (values: Partial<MakeupSession> = {}): MakeupSession => ({
  id: uuid(5), revision: 1, teacher_id: uuid(4), classroom_id: uuid(6), subject_key: "mathematics",
  session_date: "2026-10-05", start_time: "16:00", end_time: "17:00", period_ids: [], capacity: 6,
  state: "confirmed", class_id: null, teacher_name: "강사", classroom_name: "1실", taken: 1, ...values,
});
export const participant = (values: Partial<MakeupParticipant> = {}): MakeupParticipant => ({
  id: uuid(7), revision: 1, session_id: uuid(5), student_id: uuid(2), status: "unknown",
  planned_minutes: 60, actual_minutes: null, attendance_record_id: null, anchor_class_id: uuid(3), ...values,
});
export const fulfillment = (values: Partial<MakeupFulfillment> = {}): MakeupFulfillment => ({
  id: uuid(8), revision: 1, participant_id: uuid(7), version: 1, state: "draft", actual_minutes: 30,
  report_id: uuid(9), attendance_record_id: null, learning_summary: "저장한 지도 내용",
  homework: "저장한 과제", return_reason: null, ...values,
});
export const detail = (values: Partial<MakeupCaseDetail> = {}): MakeupCaseDetail => ({
  case: { ...caseRow(), note: null, policy_version_id: null, adjusted_minutes: 0, recognized_minutes: 0, waived_minutes: 0 },
  policy: null, quantities: null, sources: [], sessions: [session()], participants: [participant()],
  allocations: [], fulfillments: [], recognitions: [], adjustments: [], events: [], reconciliation: [],
  projection_jobs: [], legacy_maps: [], permissions: { reserve: true, participation: true, submit: true,
    cancel: true, reschedule: true, assign: false }, ...values,
});
