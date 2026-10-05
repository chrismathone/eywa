import { describe, expect, it } from "vitest";
import { caseDetailSchema, optionPageSchema, reconciliationPageSchema } from "./read-types";

const ID = "11111111-1111-4111-8111-111111111111";
const caseRow = {
  id: ID, revision: 1, student_id: ID, student_name: "가상학생", subject_key: "math", original_class_id: null, original_class_name: null,
  original_date: null, reason: "absence", eligibility: "approved", lifecycle: "open", closure_reason: null, target_minutes: 60,
  outstanding_minutes: 60, committed_minutes: 0, reservable_minutes: 60, owner_id: null, owner_name: null, due_date: null,
  next_session_date: null, next_action: "schedule", flags: [], imported_commitment: false, updated_at: "2026-10-05T00:00:00Z",
  note: null, policy_version_id: null, adjusted_minutes: 0, recognized_minutes: 0, waived_minutes: 0,
};
const participant = { id: ID, revision: 1, session_id: ID, student_id: ID, status: "unknown", planned_minutes: 60, actual_minutes: null, attendance_record_id: null };
const fulfillment = { id: ID, revision: 1, participant_id: ID, state: "draft", actual_minutes: 60, report_id: null, attendance_record_id: null, learning_summary: "합성", homework: null, return_reason: null };
const recon = { id: ID, revision: 1, state: "open", kind: "anchor_missing", summary: "합성", detail: { student_id: ID } };
const detail = (extra: Record<string, unknown> = {}) => ({
  case: caseRow, policy: null, quantities: null, sources: [], sessions: [], participants: [participant],
  allocations: [{ id: ID, case_id: ID, participant_id: ID, allocated_minutes: 60, released_minutes: 0 }], fulfillments: [fulfillment],
  recognitions: [], adjustments: [], events: [], reconciliation: [recon], projection_jobs: [], legacy_maps: [], permissions: { reserve: true }, ...extra,
});

describe("보강 읽기 형식 — 새 칸은 선택이고, 옛 칸은 그대로 지나간다", () => {
  it("새 칸이 없는 응답(마이그레이션 전 DB)도 그대로 읽는다", () => {
    const parsed = caseDetailSchema.parse(detail());
    expect(parsed.today).toBeUndefined();
    expect(parsed.participants[0]?.actions).toBeUndefined();
    expect(parsed.allocations[0]?.recognizable_minutes).toBeUndefined();
    expect(parsed.reconciliation[0]?.anchor_context).toBeUndefined();
  });

  it("새 칸이 있는 응답을 읽고, 선언하지 않은 옛 칸(kind·summary·detail 등)을 버리지 않는다", () => {
    const parsed = caseDetailSchema.parse(detail({
      today: "2026-10-05", events_total: 3,
      participants: [{ ...participant, anchor_class_name: "수학 가반", attendance_link: "none",
        actions: { record: false, submit: false, cancel: true, reschedule: true },
        blocked: { record: "future_session", submit: "no_open_record", cancel: null, reschedule: null } }],
      allocations: [{ id: ID, case_id: ID, participant_id: ID, allocated_minutes: 60, released_minutes: 60, recognizable_minutes: 60 }],
      fulfillments: [{ ...fulfillment, evidence_kind: "manual" }],
      reconciliation: [{ ...recon, anchor_context: { student_id: ID, subject_key: "math", session_date: "2026-10-05" } }],
    }));
    expect(parsed.today).toBe("2026-10-05");
    expect(parsed.events_total).toBe(3);
    expect(parsed.participants[0]?.blocked?.record).toBe("future_session");
    expect(parsed.participants[0]?.actions?.cancel).toBe(true);
    expect(parsed.allocations[0]).toMatchObject({ recognizable_minutes: 60, allocated_minutes: 60, released_minutes: 60 });
    expect(parsed.fulfillments[0]?.evidence_kind).toBe("manual");
    expect(parsed.reconciliation[0]).toMatchObject({ kind: "anchor_missing", summary: "합성", detail: { student_id: ID } });
    expect(parsed.reconciliation[0]?.anchor_context?.subject_key).toBe("math");
  });

  it("DB가 모르는 값을 더해도 화면 전체가 죽지 않는다(값은 문자열로 받는다)", () => {
    const parsed = caseDetailSchema.safeParse(detail({
      participants: [{ ...participant, attendance_link: "later_value", blocked: { record: "later_code", extra_action: "x" }, actions: { record: false, extra_action: true } }],
      reconciliation: [{ ...recon, anchor_context: null }],
    }));
    expect(parsed.success).toBe(true);
  });

  it("대사 목록과 선택지도 같다 — 옛 칸 유지 · 새 칸 선택", () => {
    const page = reconciliationPageSchema.parse({
      rows: [{ ...recon, anchor_context: { student_id: ID, subject_key: "math", session_date: "2026-10-05" } }, { id: ID, revision: 2, state: "open", kind: "units_review" }],
      total: 2, page: 1, page_size: 50, projection_jobs: [], projection_total: 0, projection_pending: 0, projection_failed: 0,
      projection_page: 1, projection_page_size: 50, last_success_at: "2026-10-05T00:00:00Z", last_run: null, permissions: {},
    });
    expect(page.rows[0]).toMatchObject({ kind: "anchor_missing", summary: "합성" });
    expect(page.rows[1]?.anchor_context).toBeUndefined();
    const options = optionPageSchema.parse({ total: 2, page: 1, page_size: 30, rows: [
      { id: ID, name: "가상학생A", school: "가상초등학교", grade: null, class_names: ["수학 가반"] },
      { id: ID, name: "수학 가반", subject_key: "math", teacher_id: null, active: true },
      { id: ID, name: "옛 응답" },
    ] });
    expect(options.rows[0]).toMatchObject({ school: "가상초등학교", grade: null, class_names: ["수학 가반"] });
    expect(options.rows[1]).toMatchObject({ subject_key: "math", active: true });
    expect(options.rows[2]?.class_names).toBeUndefined();
  });
});
