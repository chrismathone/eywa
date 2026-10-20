import { describe, expect, it, vi } from "vitest";
import { fakePostgrest, type FakeTables } from "./testing/fake-postgrest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
const { computeRecordCoverage, saveCoverageMark } = await import("./record-coverage");

/**
 * 기록 범위 판정 본체(적대 재리뷰 2026-10-20) — 창 첫 달 앞 두 달 청구 · 정정 뒤 최신 출석 · 시작이 창 밖일 때의 확정값(0386a).
 */
const T = "t1";
const bill = (student: string, period: string, status = "paid", tenant = T) => ({ tenant_id: tenant, id: `${tenant}-${student}-${period}`, student_id: student, period, status, category: "tuition" });
const many = (period: string, n: number, prefix = "s") => Array.from({ length: n }, (_, i) => bill(`${prefix}${i}`, period));
const months = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1 + i, 1)).toISOString().slice(0, 7));
const student = (id: string, enrolled_at: string) => ({ tenant_id: T, id, enrolled_at });
const att = (id: string, student_id: string, session_date: string, status: string, recorded_at: string) => ({ tenant_id: T, id, student_id, class_id: "c1", session_date, slot_start: null, status, recorded_at });

describe("computeRecordCoverage", () => {
  it("🔴 정정된 출석은 최신 기록으로 본다 — 출석을 결석으로 고친 학생은 수업을 시작한 등록이 아니다", async () => {
    const tables: FakeTables = {
      invoices: months("2026-01", 10).flatMap((m) => many(m, 30)),
      students: [student("x", "2026-09-01"), student("y", "2026-09-02")],
      enrollments: [],
      attendance_records: [
        att("a1", "x", "2026-09-03", "present", "2026-09-03T01:00:00Z"),
        att("a2", "x", "2026-09-03", "absent", "2026-09-03T05:00:00Z"), // 정정 — 최신 줄이 결석
        att("b1", "y", "2026-09-04", "late", "2026-09-04T01:00:00Z"),
      ],
      record_coverage_marks: [],
    };
    const v = await computeRecordCoverage(fakePostgrest(tables).db, T, "2026-10-20");
    expect(v.billingFrom).toBe("2026-01");
    expect(v.visible).toBe(true);
    expect(v.started).toEqual(["y"]);
  });

  it("창 첫 두 달 등록에도 '직전 두 달 청구' 규칙이 선다(청구를 창 앞 두 달부터 읽는다)", async () => {
    // 오늘 2029-02 → 창 = 2026-03 ~ 2029-02. 2026-03 등록 학생 r은 2026-01·02에도 청구가 있던 재원생.
    const tables: FakeTables = {
      invoices: [...months("2026-01", 38).flatMap((m) => many(m, 25)), bill("r", "2026-01"), bill("r", "2026-02"), bill("r", "2026-03")],
      students: [student("r", "2026-03-10")],
      enrollments: [],
      attendance_records: [],
      record_coverage_marks: [],
    };
    const v = await computeRecordCoverage(fakePostgrest(tables).db, T, "2029-02-10");
    expect(v.billingFrom).toBe("2026-03");
    expect(v.started).toEqual([]);
  });

  it("🔴 청구 시작이 창 밖이면 cron이 적어 둔 확정값을 쓴다 · 보일 때만 적는다", async () => {
    const tables: FakeTables = {
      invoices: months("2026-01", 40).flatMap((m) => many(m, 25)),
      students: [],
      enrollments: [],
      attendance_records: [],
      record_coverage_marks: [{ tenant_id: T, billing_from: "2026-01", trust_from: "2026-04" }],
    };
    const { db, calls } = fakePostgrest(tables);
    const v = await computeRecordCoverage(db, T, "2029-04-10"); // 창 = 2026-05 ~ — 시작(2026-01)이 보이지 않는다
    expect(v.visible).toBe(false);
    expect(v.trustFrom).toBe("2026-04");
    await saveCoverageMark(db, T, v);
    expect(calls.some((c) => c.table === "record_coverage_marks" && c.op === "upsert")).toBe(false);
    // 확정값이 없으면 종전대로(창 첫 달 — 보수적으로).
    const fresh = await computeRecordCoverage(fakePostgrest({ ...tables, record_coverage_marks: [] }).db, T, "2029-04-10");
    expect(fresh.trustFrom).toBe(fresh.billingFrom);
  });

  it("🔴 적어 둔 시작 달이 창보다 앞이면, 창 첫 달 근처가 비어 '보이는' 것처럼 읽혀도 확정값을 덮어쓰지 않는다", async () => {
    // 창 = 2026-05 ~ 2029-04. 창 앞 두 달(2026-03·04)과 창 첫 두 달이 비어 시작이 2026-07로 '보인다' — 실제 시작은 2026-01(확정값).
    const tables: FakeTables = {
      invoices: [...months("2026-01", 2).flatMap((m) => many(m, 25)), ...months("2026-07", 34).flatMap((m) => many(m, 25))],
      students: [],
      enrollments: [],
      attendance_records: [],
      record_coverage_marks: [{ tenant_id: T, billing_from: "2026-01", trust_from: "2026-04" }],
    };
    const { db, calls } = fakePostgrest(tables);
    const v = await computeRecordCoverage(db, T, "2029-04-10");
    expect(v.billingFrom).toBe("2026-07");
    expect(v.visible).toBe(false);
    expect(v.trustFrom).toBe("2026-04");
    await saveCoverageMark(db, T, v);
    expect(calls.some((c) => c.table === "record_coverage_marks" && c.op === "upsert")).toBe(false);
  });

  it("휴원 수강은 근거가 아니다 · 결론이 난 등록(직전 두 달 청구)은 출석을 읽지 않는다", async () => {
    const tables: FakeTables = {
      invoices: [...months("2026-01", 10).flatMap((m) => many(m, 30)), bill("old", "2026-07"), bill("old", "2026-08")],
      students: [student("h", "2026-09-01"), student("old", "2026-09-10")],
      enrollments: [{ tenant_id: T, id: "e1", student_id: "h", start_date: "2026-09-02", end_date: null, on_hold: true }],
      attendance_records: [att("x1", "old", "2026-09-11", "present", "2026-09-11T01:00:00Z")],
      record_coverage_marks: [],
    };
    const { db } = fakePostgrest(tables);
    const v = await computeRecordCoverage(db, T, "2026-10-20");
    expect(v.started).toEqual([]); // h: 휴원 수강뿐 · old: 등록일만 고쳐진 재원생(출석이 있어도)
  });

  it("시작이 보이면 판정값을 확정값으로 적는다 · 확정값을 못 읽어도 판정은 그대로", async () => {
    const tables: FakeTables = {
      invoices: months("2026-01", 10).flatMap((m) => many(m, 25)),
      students: [],
      enrollments: [],
      attendance_records: [],
      record_coverage_marks: [],
    };
    const { db } = fakePostgrest(tables);
    const v = await computeRecordCoverage(db, T, "2026-10-20");
    await saveCoverageMark(db, T, v);
    expect(tables.record_coverage_marks).toEqual([expect.objectContaining({ tenant_id: T, billing_from: "2026-01", trust_from: null })]);
    const broken = await computeRecordCoverage(fakePostgrest(tables, { fail: (t) => t === "record_coverage_marks" }).db, T, "2026-10-20");
    expect(broken.billingFrom).toBe("2026-01");
  });
});
