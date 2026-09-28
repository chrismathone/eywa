import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSettings } from "@/features/owner/resolve";
import { logAction } from "@/features/audit/server/log";
import { virtualTermId } from "../month-roster";
import { MATERIALIZE_ERROR, materializeVirtualTerms } from "./term-materialize";

/**
 * 가상 회차 행 → 실제 행(원장 2026-09-18 "출석부 행 개수 = 회차 확정 행 개수"). 판정(#77)·사유 문구·생성 컬럼·감사로그를 잠근다.
 * 모의 DB는 eq/in/lte/gte를 **실제로 거른다**(판정이 쿼리 조건에 기대므로) — upsert는 (tenant, invoice, class) 충돌이면 건너뛴다.
 */
const h = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Record<string, unknown>[]>,
    upserts: [] as Record<string, unknown>[],
    after: [] as (() => Promise<void>)[],
    plans: new Map<string, Map<string, number>>(),
    periodDefs: [] as unknown[],
    seq: 0,
  };
  const client = {
    from(table: string) {
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      let upserting: Record<string, unknown>[] | null = null;
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "order", "range"]) builder[m] = () => builder;
      builder.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return builder; };
      builder.in = (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return builder; };
      builder.lte = (c: string, v: string) => { filters.push((r) => String(r[c]) <= v); return builder; };
      builder.gte = (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return builder; };
      builder.upsert = (rows: Record<string, unknown>[]) => { upserting = rows; return builder; };
      builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const rows = (state.tables[table] ??= []);
        if (upserting) {
          const inserted: Record<string, unknown>[] = [];
          for (const row of upserting) {
            state.upserts.push(row);
            if (rows.some((r) => r.tenant_id === row.tenant_id && r.invoice_id === row.invoice_id && r.class_id === row.class_id)) continue; // ON CONFLICT DO NOTHING
            const made = { id: `made-${++state.seq}`, confirmed_sessions: null, ...row };
            rows.push(made);
            inserted.push(made);
          }
          return Promise.resolve({ data: inserted, error: null }).then(resolve, reject);
        }
        const data = rows.filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      };
      return builder;
    },
  };
  return { state, client };
});

vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => resolveSettings({}, { name: "학원" }) }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => h.state.after.push(fn) }));
vi.mock("@/features/attendance/server/makeup-pool", () => ({ listMakeupPoolClassIds: async () => [] }));
vi.mock("@/features/attendance/server/makeup-reservation-queries", () => ({ getReservationsInRange: async () => [] }));
vi.mock("./live-plans", () => ({ loadLivePlans: async () => ({ plans: h.state.plans }) }));
// 세션 기간 정의 — 기본은 없음(달력월). 세션 창 판정은 따로 잠근다.
vi.mock("@/features/periods/server/queries", () => ({ getPeriodDefs: async () => h.state.periodDefs }));

const T = "tenant";
const P = "2026-09";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const S3 = "33333333-3333-4333-8333-333333333333";
const C1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const C2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const db = h.client as never;
const ctx = (extra: Partial<Parameters<typeof materializeVirtualTerms>[1]> = {}) => ({ tenantId: T, period: P, reason: "confirm" as const, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  h.state.after = [];
  h.state.upserts = [];
  h.state.seq = 0;
  h.state.periodDefs = [];
  h.state.plans = new Map([[S1, new Map([[C1, 8]])]]);
  h.state.tables = {
    classes: [
      { id: C1, class_name: "수학A", subject: "math", english_track: null, closed_at: null, is_active: true, teacher: null },
      { id: C2, class_name: "수학B", subject: "math", english_track: null, closed_at: null, is_active: true, teacher: null },
    ],
    // S1: C1 수강(청구서 있음) · C2는 수강행 없이 보강 방문 기록만 / S2: C1 수강, 청구서 없음 / S3: C1 수강, 청구서 취소
    enrollments: [
      { id: "e1", student_id: S1, class_id: C1, start_date: "2026-03-01", end_date: null, on_hold: false },
      { id: "e2", student_id: S2, class_id: C1, start_date: "2026-03-01", end_date: null, on_hold: false },
      { id: "e3", student_id: S3, class_id: C1, start_date: "2026-03-01", end_date: null, on_hold: false },
    ],
    attendance_records: [{ id: "a1", student_id: S1, class_id: C2, session_date: "2026-09-06", slot_start: null, status: "makeup", session_units: 1.5, recorded_at: "2026-09-01T00:00:00Z" }],
    invoices: [
      { id: "inv-1", student_id: S1, period: P, status: "issued" },
      { id: "inv-3", student_id: S3, period: P, status: "void" },
    ],
    invoice_session_terms: [],
  };
});

describe("materializeVirtualTerms — 확정·배분을 저장하는 순간에만 행을 만든다", () => {
  it("수강 줄은 예정 시수(live plan)를, 보강 방문 줄은 예정 없음(null)으로 만든다 — 확정 필드는 안 싣는다", async () => {
    const a = virtualTermId(S1, C1);
    const b = virtualTermId(S1, C2);
    const out = await materializeVirtualTerms(db, ctx({ reason: "confirm_selected" }), [a, b]);
    expect(out.failed.size).toBe(0);
    expect(out.created).toBe(2);
    expect(h.state.upserts).toEqual([
      { tenant_id: T, invoice_id: "inv-1", subject: "math", class_id: C1, planned_sessions: 8 },
      { tenant_id: T, invoice_id: "inv-1", subject: "math", class_id: C2, planned_sessions: null },
    ]);
    for (const row of h.state.upserts) expect(Object.keys(row).some((k) => k.startsWith("confirmed") || k.startsWith("allocation") || k === "note")).toBe(false);
    expect(out.ids.get(a)).toMatch(/^made-/);
    // 감사로그는 응답 뒤, 새로 만든 행마다 — 어느 저장이 만들었나·예정 시수.
    for (const fn of h.state.after) await fn();
    expect(logAction).toHaveBeenCalledTimes(2);
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: "session_term_create", targetType: "invoice_session_term", metadata: expect.objectContaining({ period: P, classId: C2, studentId: S1, reason: "confirm_selected", plannedSessions: null, recordedUnits: 1.5 }) }));
  });

  it("🔴 청구서가 없거나 취소된 줄은 만들지 않고 사유를 갈라 말한다", async () => {
    const none = virtualTermId(S2, C1);
    const voided = virtualTermId(S3, C1);
    const out = await materializeVirtualTerms(db, ctx(), [none, voided]);
    expect(out.ids.size).toBe(0);
    expect(out.failed.get(none)).toBe(MATERIALIZE_ERROR.noInvoice);
    expect(out.failed.get(voided)).toBe(MATERIALIZE_ERROR.voidInvoice);
    expect(h.state.upserts).toEqual([]);
  });

  it("🔴 #77 — 지금 그 달 출석부 줄이 아닌 쌍(휴원으로 바뀜)·다른 반·모양이 틀린 id는 거절한다", async () => {
    h.state.tables.enrollments[0].on_hold = true;
    const held = virtualTermId(S1, C1);
    const out = await materializeVirtualTerms(db, ctx({ classId: C2 }), [held, virtualTermId(S1, C2), "v:bogus:x"]);
    expect(out.failed.get(held)).toBe(MATERIALIZE_ERROR.wrongClass); // 반 확인이 먼저
    expect(out.failed.get("v:bogus:x")).toBe(MATERIALIZE_ERROR.invalid);
    // 휴원 수강행이 있는 학생의 기록은 출석부가 숨긴다 → 줄이 아니다.
    const again = await materializeVirtualTerms(db, ctx(), [held, virtualTermId(S1, C2)]);
    expect(again.failed.get(held)).toBe(MATERIALIZE_ERROR.notInRoster);
    expect(again.ids.has(virtualTermId(S1, C2))).toBe(true);
  });

  it("반 일괄 확정(plannedOnly)은 보강 방문 줄도, 예정 0인 수강 줄(월초 종료·반이동)도 만들지 않는다", async () => {
    const out = await materializeVirtualTerms(db, ctx({ reason: "confirm_class", classId: C2, plannedOnly: true }), [virtualTermId(S1, C2)]);
    expect(out.failed.get(virtualTermId(S1, C2))).toBe(MATERIALIZE_ERROR.unplanned);
    // S1은 C1에 예정 8 — 만든다. S1-C1의 예정을 0으로 바꾸면(9/1 종료 등) 안 만든다.
    h.state.plans = new Map([[S1, new Map([[C1, 0]])]]);
    const zero = await materializeVirtualTerms(db, ctx({ reason: "confirm_class", classId: C1, plannedOnly: true }), [virtualTermId(S1, C1)]);
    expect(zero.failed.get(virtualTermId(S1, C1))).toBe(MATERIALIZE_ERROR.unplanned);
    expect(h.state.upserts).toEqual([]);
    // 개별 확정은 사람이 줄마다 값을 보고 누르므로 예정 0이어도 만든다.
    const one = await materializeVirtualTerms(db, ctx(), [virtualTermId(S1, C1)]);
    expect(one.created).toBe(1);
  });

  it("🔑 기간 창은 출석부와 같다 — 반의 과목에 세션이 있으면 세션 창으로 줄을 세운다", async () => {
    // 수학 9월 세션 = 9/1~10/1(운영 실측 모양). 10/1에 찍힌 보강 방문은 9월 줄, 달력월이었다면 10월 줄.
    h.state.periodDefs = [{ id: "p9", subjectKey: "math", classId: null, labelYear: 2026, labelMonth: 9, startDate: "2026-09-01", endDate: "2026-10-01" }];
    h.state.tables.attendance_records.push({ id: "a2", student_id: S2, class_id: C2, session_date: "2026-10-01", slot_start: null, status: "makeup", session_units: 1, recorded_at: "2026-09-01T00:00:00Z" });
    h.state.tables.invoices.push({ id: "inv-2", student_id: S2, period: P, status: "issued" });
    const out = await materializeVirtualTerms(db, ctx(), [virtualTermId(S2, C2)]);
    expect(out.created).toBe(1);
    h.state.periodDefs = [];
    const calendar = await materializeVirtualTerms(db, ctx(), [virtualTermId(S3, C2)]);
    expect(calendar.failed.get(virtualTermId(S3, C2))).toBe(MATERIALIZE_ERROR.notInRoster);
  });

  it("배분은 그 청구서의 학생만 — 남의 청구서면 거절, 이 반 행이 형제 청구서에 있으면 거절", async () => {
    const other = await materializeVirtualTerms(db, ctx({ reason: "allocate", invoiceId: "inv-3" }), [virtualTermId(S1, C1)]);
    expect(other.failed.get(virtualTermId(S1, C1))).toBe(MATERIALIZE_ERROR.otherInvoice);
    h.state.tables.invoices.push({ id: "inv-1b", student_id: S1, period: P, status: "issued" });
    h.state.tables.invoice_session_terms.push({ id: "t-sib", tenant_id: T, invoice_id: "inv-1b", class_id: C1, confirmed_sessions: 4 });
    const sib = await materializeVirtualTerms(db, ctx({ reason: "allocate", invoiceId: "inv-1" }), [virtualTermId(S1, C1)]);
    expect(sib.failed.get(virtualTermId(S1, C1))).toBe(MATERIALIZE_ERROR.termOnOtherInvoice);
    // 확정 경로는 이미 있는 그 행을 쓴다(새로 만들지 않는다).
    const confirm = await materializeVirtualTerms(db, ctx(), [virtualTermId(S1, C1)]);
    expect(confirm.ids.get(virtualTermId(S1, C1))).toBe("t-sib");
    expect(confirm.created).toBe(0);
    expect(h.state.upserts).toEqual([]);
  });

  it("🔴 판정 뒤 다른 창이 먼저 만든 행은 한 글자도 안 바꾸고 그 id를 쓴다 — 감사로그도 안 남긴다", async () => {
    // resolve 단계엔 없고 upsert 순간엔 있는 경쟁을 흉내 낸다: 판정 조회 뒤에 끼워 넣는다.
    const origFrom = h.client.from.bind(h.client);
    let termReads = 0;
    vi.spyOn(h.client, "from").mockImplementation((table: string) => {
      if (table === "invoice_session_terms" && ++termReads === 2) {
        h.state.tables.invoice_session_terms.push({ id: "t-race", tenant_id: T, invoice_id: "inv-1", class_id: C1, confirmed_sessions: 6 });
      }
      return origFrom(table);
    });
    const out = await materializeVirtualTerms(db, ctx(), [virtualTermId(S1, C1)]);
    expect(out.ids.get(virtualTermId(S1, C1))).toBe("t-race");
    expect(out.created).toBe(0);
    expect(h.state.tables.invoice_session_terms.find((r) => r.id === "t-race")).toMatchObject({ confirmed_sessions: 6 });
    for (const fn of h.state.after) await fn();
    expect(logAction).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
