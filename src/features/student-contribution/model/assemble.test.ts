import { expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { assembleContribution } from "./assemble";
import { DEFAULT_CONFIG } from "./config";
import type { ParentEventSources } from "./parent-events/facts";
import { sumRaws } from "./calc";

it("설명회는 마감한 과거를 보존하고 정정·취소를 한 번만 반영하며 원본 장애를 차감으로 처리하지 않는다", () => {
  const input = fixture(), first = assembleContribution(input);
  const parentEvents: ParentEventSources = { ready: true, checkedAt: input.capturedAt, records: [{ tenantId: input.tenant, studentId: "s",
    eventId: "event", eventDate: "2025-07-09", title: "학부모 설명회", sourceIds: ["source"], familyKey: "family", basis: "direct", attendanceBasis: "registration_policy" }] };
  const next = assembleContribution({ ...input, stored: first.rows, historyReady: true, parentEvents });
  const current = next.rows.find(r => r.month === "2026-10")!;
  expect(current.correction.parentSeminarEvents).toBe(1);
  expect(next.rows.find(r => r.month === "2026-09")).toEqual(first.rows.find(r => r.month === "2026-09"));
  expect(next.rows.find(r => r.month === "2025-07")!.raws.parentSeminarEvents).toBe(0);
  const repeated = assembleContribution({ ...input, stored: next.rows, historyReady: true, parentEvents });
  expect(sumRaws(repeated.rows.flatMap(r => [r.raws, r.correction])).parentSeminarEvents).toBe(1);
  const cancelled = assembleContribution({ ...input, stored: next.rows, historyReady: true, parentEvents: { ...parentEvents, records: [] } });
  expect(sumRaws(cancelled.rows.flatMap(r => [r.raws, r.correction])).parentSeminarEvents).toBe(0);
  expect(() => assembleContribution({ ...input, stored: next.rows, historyReady: true })).toThrow("이전에 연결한 설명회");
});
import type { CoreSources, ContributionStudent } from "../server/source-types";
import type { ActivitySources } from "../server/activity-sources";
import { CONTRIBUTION_PILOT_TENANT } from "./access";

const student = (id: string): ContributionStudent => ({ id, name: id, school: null, grade: "초5", status: "enrolled", is_test: false, notes: null,
  parent_phone: null, makeedu_id: null, withdrawal_metadata: null });
const invoice = (id: string, student_id: string, paid: number) => ({ id, student_id, period: "2026-09", status: "paid", category: "tuition", amount_total: paid, amount_paid: paid,
  line_items: [{ kind: "tuition", subject: "math", amount: paid, paid }] });
const fixture = () => {
  const core: CoreSources = { students: [student("s")], classes: [], users: [], enrollments: [], schedules: [], transitions: [], consultations: [], historyLinks: [], invoices: [invoice("i", "s", 300000)] };
  const activity: ActivitySources = { attendance: [], grades: [], assignments: [], videos: [], marks: [], signals: [], signalRows: [], signalSources: [], pendingSignals: [], aiLicensed: true };
  return { tenant: "t", today: "2026-10-22", capturedAt: "2026-10-22T00:00:00Z", core, activity,
    config: DEFAULT_CONFIG, settings: { ...DEFAULT_SETTINGS, operations: { ...DEFAULT_SETTINGS.operations, subjects: [{ ...DEFAULT_SETTINGS.operations.subjects[0]!, key: "math", label: "수학" }] } },
    history: [], historyReady: false, stored: [] } satisfies Parameters<typeof assembleContribution>[0];
};
it("전체 조립: 첫 과거 복원 → 환불은 이번 달 정정, 마감 원본·근거 보존", () => {
  const input = fixture(), first = assembleContribution(input);
  expect(first.rows.find((r) => r.month === "2026-09")!.raws).toMatchObject({ tuitionWon: 300000, subjectMonths: 1 });
  input.core.invoices = [invoice("i", "s", 200000)];
  const next = assembleContribution({ ...input, stored: first.rows, historyReady: true, history: null });
  expect(next.rows.find((r) => r.month === "2026-09")).toEqual(first.rows.find((r) => r.month === "2026-09"));
  const current = next.rows.find((r) => r.month === "2026-10")!;
  expect(current.correction.tuitionWon).toBe(-100000);
  expect(current.payload.corrections).toContainEqual(expect.objectContaining({ month: "2026-09", metric: "tuitionWon", before: 300000, after: 200000, delta: -100000 }));
});
it("병합은 살아남은 학생의 정정으로 옮기고 옛 원본 학생 id를 보존", () => {
  const input = fixture(); input.core.students.push(student("kept")); input.core.invoices.push(invoice("j", "kept", 200000));
  const first = assembleContribution(input);
  input.core.students[0]!.notes = "중복 병합: kept와 통합됨";
  const merged = assembleContribution({ ...input, stored: first.rows, historyReady: true, history: null });
  expect(merged.roster.map((s) => s.id)).toEqual(["kept"]);
  expect(sumRaws(merged.rows.flatMap((r) => [r.raws, r.correction])).tuitionWon).toBe(500000);
  expect(merged.rows.find((r) => r.month === "2026-10")!.correction.tuitionWon).toBe(300000);
  expect(first.rows.find((r) => r.studentId === "s" && r.month === "2026-09")!.payload.facts[0]!.evidence[0]!.studentId).toBe("s");
});
it("첫 집계가 중간에 끊겨도 이미 마감한 달은 유지하고 남은 과거 달을 복원", () => {
  const input = fixture(); input.core.invoices.push({ ...invoice("old", "s", 100000), period: "2026-08" });
  const first = assembleContribution(input), frozen = first.rows.find((r) => r.month === "2026-08")!;
  const resumed = assembleContribution({ ...input, stored: [frozen] });
  expect(resumed.rows.find((r) => r.month === "2026-08")).toEqual(frozen);
  expect(resumed.rows.find((r) => r.month === "2026-09")!.closedAt).toBeTruthy();
  expect(resumed.rows.find((r) => r.month === "2026-10")!.correction.tuitionWon).toBe(0);
});
it("재원 개월은 과목 수와 무관하며 마감 후 전액 환불과 병합을 현재 달에 반영한다", () => {
  const input = fixture();
  input.core.students.push(student("kept"));
  input.core.invoices.push(invoice("second", "s", 200000), invoice("same-month", "kept", 100000), { ...invoice("prior", "s", 100000), period: "2026-08" });
  const first = assembleContribution(input);
  expect(first.rows.find((r) => r.studentId === "s" && r.month === "2026-10")!.payload.enrolledMonths).toBe(2);
  input.core.students[0]!.notes = "중복 병합: kept와 통합됨";
  const merged = assembleContribution({ ...input, stored: first.rows, historyReady: true });
  expect(merged.rows.find((r) => r.studentId === "kept" && r.month === "2026-10")!.payload.enrolledMonths).toBe(2);
  input.core.invoices = input.core.invoices.map((i) => i.period === "2026-08" ? { ...i, status: "refunded" } : i);
  const refunded = assembleContribution({ ...input, stored: merged.rows, historyReady: true });
  expect(refunded.rows.find((r) => r.studentId === "kept" && r.month === "2026-10")!.payload.enrolledMonths).toBe(1);
  expect(refunded.rows.find((r) => r.studentId === "kept" && r.month === "2026-09")).toEqual(merged.rows.find((r) => r.studentId === "kept" && r.month === "2026-09"));
});
it("지난달 AI 대기가 남아 있어도 현재 목록은 계산 완료로 표시하지 않는다", () => {
  const input = fixture(); input.activity.pendingSignals.push({ id: "p", studentId: "s", source: "parent", day: "2026-09-01", text: "노력", author: null, hash: "hash" });
  const current = assembleContribution(input).rows.find((r) => r.month === "2026-10")!;
  expect(current.unavailable).toContain("parentPositiveMonths");
  expect(current.unavailable).not.toContain("teacherPositiveMonths");
  expect(current.payload.unavailableDetails).toContainEqual(expect.objectContaining({ metric: "parentPositiveMonths", count: 1, months: ["2026-09"] }));
});
it("점수가 없는 상담도 학생의 원래 발생 달에 남는다", () => {
  const input = fixture(); input.core.consultations.push({ id: "consult", student_id: "s", referrer_student_id: null, referrer_staff_id: null,
    prospect_name: "s", prospect_school: null, prospect_grade: null, parent_phone: null, consultation_date: "2025-03-12", received_date: null,
    created_at: "2025-03-12T00:00:00Z", subject: "math", referrer_name: null, consultation_path: null, parent_request: null, safety_notes: null, follow_up_content: null });
  const row = assembleContribution(input).rows.find((r) => r.month === "2025-03")!;
  expect(row.payload.facts).toContainEqual(expect.objectContaining({ id: "consultation:consult", occurred: { precision: "day", value: "2025-03-12" } }));
  expect(Object.values(row.raws).every((v) => v === 0)).toBe(true);
});
it("지난 청구 수정과 새 과거 연결은 마감 후 이번 달에 정정", () => {
  const input = fixture(); input.core.historyLinks.push({ makeedu_no: "1", student_id: "s" });
  const old = { makeedu_no: "1", bill_month: "2025-01-01", seq: 1, item_kind: "lesson", item_name: "수학", billed: 100000, paid: 100000, refunded: false };
  const first = assembleContribution({ ...input, history: [old] });
  const next = assembleContribution({ ...input, stored: first.rows, historyReady: true, history: [old, { ...old, seq: 2, paid: 50000, refunded: true }] });
  expect(next.rows.find((r) => r.month === "2025-01")).toEqual(first.rows.find((r) => r.month === "2025-01"));
  expect(next.rows.find((r) => r.month === "2026-10")!.correction.tuitionWon).toBe(-50000);
});
it("나중에 연결된 지난 달은 근거를 보존하고 실적은 이번 달 정정으로만 인정", () => {
  const input = fixture(), first = assembleContribution(input);
  input.core.invoices.push({ ...invoice("late", "s", 120000), period: "2026-03" });
  const next = assembleContribution({ ...input, stored: first.rows, historyReady: true });
  const past = next.rows.find((r) => r.month === "2026-03")!;
  expect(past.raws.tuitionWon).toBe(0); expect(past.payload.facts).toContainEqual(expect.objectContaining({ kind: "tuition", value: expect.objectContaining({ tuitionWon: 120000 }) }));
  expect(next.rows.find((r) => r.month === "2026-10")!.correction.tuitionWon).toBe(120000);
  expect(sumRaws(next.rows.flatMap((r) => [r.raws, r.correction])).tuitionWon).toBe(420000);
});
it("당시 시간표 근거가 없는 옛 수강에는 현재 강사를 소급 연결하지 않는다", () => {
  const input = fixture();
  input.core.classes.push({ id: "c", class_name: "반", subject: "math", english_track: null, teacher_id: "current-teacher", is_active: true, closed_at: null, report_optout: false, is_makeup_pool: false });
  input.core.enrollments.push({ id: "enrolled", student_id: "s", class_id: "c", start_date: "2025-03-01", end_date: null, on_hold: false, attendance_days: null, is_transferred: false, is_transferred_in: false });
  const fact = assembleContribution(input).rows.find((r) => r.month === "2025-03")!.payload.facts.find((f) => f.kind === "enrolled")!;
  expect(fact.related).toContainEqual({ kind: "class", id: "c" });
  expect(fact.related.some((r) => r.kind === "teacher")).toBe(false);
});
it("검수 출처는 저장 결과에 남고 마감 뒤 새로 확인한 출처도 이번 달에 보존한다", () => {
  const input = fixture(); input.tenant = CONTRIBUTION_PILOT_TENANT;
  input.settings.operations.subjects.push({ ...input.settings.operations.subjects[0]!, key: "english", label: "영어" });
  input.core.historyLinks.push({ makeedu_no: "10903", student_id: "s" });
  const bill = { makeedu_no: "10903", bill_month: "2022-08-01", seq: 1, item_kind: "lesson", item_name: "(재원생여름특강)", billed: 20000, paid: 20000, refunded: false };
  const beforeReview = assembleContribution({ ...input, tenant: "other-campus", history: [bill] });
  const first = assembleContribution({ ...input, history: [bill] });
  const expected = expect.objectContaining({ billId: "10903:2022-08-01:1", month: "2022-08", subject: "english", basis: "reviewed_source",
    reference: expect.stringContaining("1sf6lEWVGmOssGiKwtW0o8CSjbssZTcweTDJsAO25WvQ") });
  expect(first.rows.find(r => r.month === "2022-08")!.historical[0]!.subjectResolutions).toContainEqual(expected);
  const corrected = assembleContribution({ ...input, history: [bill], stored: beforeReview.rows, historyReady: true });
  expect(corrected.rows.find(r => r.month === "2022-08")).toEqual(beforeReview.rows.find(r => r.month === "2022-08"));
  expect(corrected.rows.find(r => r.month === "2026-10")!.payload.subjectResolutions).toContainEqual(expected);
  expect(corrected.rows.find(r => r.month === "2026-10")!.correction.subjectMonths).toBe(1);
});
it("정확한 청구를 대조한 검수 결과를 현재 반 이름에 의한 추정보다 우선한다", () => {
  const input = fixture(); input.tenant = CONTRIBUTION_PILOT_TENANT;
  input.settings.operations.subjects.push({ ...input.settings.operations.subjects[0]!, key: "english", label: "영어" });
  input.core.historyLinks.push({ makeedu_no: "10903", student_id: "s" });
  input.core.classes.push({ id: "c", class_name: "(재원생여름특강)", subject: "math", english_track: null, teacher_id: null,
    is_active: true, closed_at: null, report_optout: false, is_makeup_pool: false });
  const history = [{ makeedu_no: "10903", bill_month: "2022-08-01", seq: 1, item_kind: "lesson", item_name: "(재원생여름특강)", billed: 20000, paid: 20000, refunded: false }];
  const row = assembleContribution({ ...input, history }).rows.find(r => r.month === "2022-08")!;
  expect(row.historical[0]!.subjects).toEqual(["english"]);
});
it("원장 확인으로 해소한 과목은 확인 전 표시를 지우고 확인 근거를 현재 달에 남긴다", () => {
  const input = fixture(); input.tenant = CONTRIBUTION_PILOT_TENANT;
  input.core.historyLinks.push({ makeedu_no: "09417", student_id: "s" });
  const history = [{ makeedu_no: "09417", bill_month: "2024-02-01", seq: 5, item_kind: "lesson", item_name: "중등3T 월수목", billed: 278000, paid: 278000, refunded: false }];
  const before = assembleContribution({ ...input, tenant: "other-campus", history });
  expect(before.rows.find(r => r.month === "2026-10")!.unavailable).toContain("subjectMonths");
  const after = assembleContribution({ ...input, history, historyReady: true, stored: before.rows });
  expect(after.rows.find(r => r.month === "2024-02")).toEqual(before.rows.find(r => r.month === "2024-02"));
  const current = after.rows.find(r => r.month === "2026-10")!;
  expect(current.unavailable).not.toContain("subjectMonths");
  expect(current.correction.subjectMonths).toBe(1);
  expect(current.payload.subjectResolutions).toContainEqual(expect.objectContaining({ subject: "math", basis: "owner_confirmed", reference: expect.stringContaining("원장 확인") }));
});
