import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(), visible: vi.fn(), from: vi.fn(), queries: [] as { table: string; calls: [string, unknown[]][] }[],
  /** 표별 응답 덮어쓰기(테스트마다 초기화) — 없으면 아래 기본값. */
  tables: {} as Record<string, unknown[]>,
  errors: {} as Record<string, { message: string }>,
}));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: mocks.access }));
vi.mock("./teacher-axis-queries", () => ({ loadVisibleClassAxisRows: mocks.visible }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));

import { getAttendanceClassBilledAmounts, mergeAttendanceClassBilling } from "./class-billing";
import { rowKey } from "../grid/model";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queries.length = 0;
  mocks.tables = {};
  mocks.errors = {};
  mocks.access.mockResolvedValue({ tenantId: "tenant-1", systemRole: "teacher" });
  mocks.visible.mockResolvedValue([{ id: "c1", className: "고등M TP4E" }]);
  mocks.from.mockImplementation((table: string) => {
    const query = { table, calls: [] as [string, unknown[]][] };
    mocks.queries.push(query);
    // 청구서는 **void 포함**으로 돌아온다(2026-09-18) — s1 살아 있는 청구서 · s2 취소된 청구서만 · s3 없음.
    const data = mocks.tables[table] ?? (table === "invoices"
      ? [
          { id: "i1", student_id: "s1", status: "issued", line_items: [{ description: "고등M TP4E", amount: 210000 }] },
          { id: "i2", student_id: "s2", status: "void", line_items: [{ description: "고등M TP4E", amount: 210000 }] },
        ]
      : [{ id: "t1", invoice_id: "i1", class_id: "c1", amount: null, confirmed_sessions: null, allocation_line_index: null }]);
    const error = mocks.errors[table] ?? null;
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "in", "order", "range", "lte", "or"]) {
      builder[method] = (...args: unknown[]) => { query.calls.push([method, args]); return builder; };
    }
    builder.then = (resolve: (result: unknown) => unknown) => Promise.resolve(resolve(error ? { data: null, error } : { data, error: null }));
    return builder;
  });
});

describe("강사 출석부 청구액 조회 범위", () => {
  it("확정 시수에서 남는 1U는 조회 중인 강사가 아니라 반 담임에게 배분한다", async () => {
    mocks.visible.mockResolvedValue([{ id: "c1", className: "중등E 정규" }]);
    mocks.tables.invoices = [{ id: "i1", student_id: "s1", status: "issued", line_items: [{ description: "중등E 정규", amount: 132000 }] }];
    mocks.tables.classes = [{ id: "c1", class_name: "중등E 정규", teacher_id: "home", english_track: "injaewon" }];
    mocks.tables.class_schedules = [
      { class_id: "c1", day_of_week: "tue", start_time: "19:00", end_time: "20:00", teacher_id: "home", slot_teacher_label: null, valid_from: "2026-09-01", valid_to: null },
      { class_id: "c1", day_of_week: "tue", start_time: "20:00", end_time: "21:00", teacher_id: null, slot_teacher_label: "JJ", valid_from: "2026-09-01", valid_to: null },
    ];
    mocks.tables.enrollments = [{ class_id: "c1", student_id: "s1", start_date: "2026-09-01", end_date: null, is_transferred: false, attendance_days: [] }];
    mocks.tables.invoice_session_terms = [{ id: "t1", invoice_id: "i1", class_id: "c1", amount: 132000, confirmed_sessions: 11, unit_price: 12000, quantity_basis: "attendance_units", pricing_mode: "per_session" }];
    for (const [teacherId, expected] of [["home", 6], ["other", 0]] as const) {
      const result = await getAttendanceClassBilledAmounts("2026-09", [{ classId: "c1", studentIds: ["s1"] }], {
        teacherScope: { teacherId, classIds: ["c1"], holidays: [] },
      });
      expect(result.confirmedSessions[rowKey("c1", "s1")]).toEqual({ units: expected, daysBasis: false, classUnits: 11 });
      expect(result.billed[rowKey("c1", "s1")]).toBe(132000);
    }
  });

  it("인재원 50분 교시는 1U이며 단축 40분 교시가 섞여도 JJ를 포함해 24U를 배분한다", async () => {
    mocks.tables.classes = [{ id: "c1", class_name: "중고E_중2 특별", teacher_id: "elsa", english_track: "injaewon" }];
    const slots = [
      ["mon", "19:20", "20:10", null, "JJ"], ["mon", "20:20", "21:10", "elsa", null],
      ["wed", "19:20", "20:10", "elsa", null], ["wed", "20:20", "21:10", "elsa", null],
      ["thu", "19:20", "20:10", null, "JJ"], ["thu", "20:20", "21:00", "song", null],
    ];
    mocks.tables.class_schedules = slots.map(([day, start, end, teacher, label], i) => ({
      id: `slot-${i}`, class_id: "c1", day_of_week: day, start_time: start, end_time: end,
      teacher_id: teacher, slot_teacher_label: label, valid_from: "2026-09-01", valid_to: null,
    }));
    mocks.tables.enrollments = [{ class_id: "c1", student_id: "s1", start_date: "2026-09-01", end_date: null, is_transferred: false, attendance_days: [] }];
    mocks.tables.invoice_session_terms = [{ id: "t1", invoice_id: "i1", class_id: "c1", amount: 300000, confirmed_sessions: 24, unit_price: 12500, quantity_basis: "attendance_units", pricing_mode: "per_session" }];
    for (const [teacherId, expected] of [["elsa", 14], ["song", 3]] as const) {
      const result = await getAttendanceClassBilledAmounts("2026-09", [{ classId: "c1", studentIds: ["s1"] }], {
        teacherScope: { teacherId, classIds: ["c1"], holidays: ["2026-09-24", "2026-09-25", "2026-09-26"] },
      });
      expect(result.confirmedSessions[rowKey("c1", "s1")]).toEqual({ units: expected, daysBasis: false, classUnits: 24 });
      expect(result.confirmedPrices[rowKey("c1", "s1")]).toEqual([{ unitPrice: 12500, monthly: false, daysBasis: false }]);
    }
  });

  it("영어 강사 보기만 등록 차수를 교시 담당별로 배분하고 청구액·단가는 유지한다", async () => {
    mocks.tables.classes = [{ id: "c1", teacher_id: "home", english_track: "eie" }];
    mocks.tables.class_schedules = [
      { class_id: "c1", day_of_week: "tue", start_time: "14:00", end_time: "14:40", teacher_id: "home", slot_teacher_label: null, valid_from: "2026-09-01", valid_to: null },
      { class_id: "c1", day_of_week: "tue", start_time: "14:40", end_time: "15:20", teacher_id: "other", slot_teacher_label: null, valid_from: "2026-09-01", valid_to: null },
    ];
    mocks.tables.enrollments = [{ class_id: "c1", student_id: "s1", start_date: "2026-09-01", end_date: null, is_transferred: false, attendance_days: ["tue"] }];
    mocks.tables.invoice_session_terms = [{ id: "t1", invoice_id: "i1", class_id: "c1", amount: 250000, confirmed_sessions: 8, unit_price: 250000, quantity_basis: "attendance_units", pricing_mode: "monthly", allocation_line_index: null }];
    const roster = [{ classId: "c1", studentIds: ["s1"] }, { classId: "forbidden", studentIds: ["other-student"] }];
    const full = await getAttendanceClassBilledAmounts("2026-09", roster);
    expect(mocks.queries.some((q) => q.table === "class_schedules")).toBe(false);
    const scoped = await getAttendanceClassBilledAmounts("2026-09", roster, {
      teacherScope: { teacherId: "other", classIds: ["c1", "forbidden"], holidays: [] },
    });
    expect(scoped.confirmedSessions[rowKey("c1", "s1")]).toEqual({ units: 4, daysBasis: false, classUnits: 8 });
    expect(full.confirmedSessions[rowKey("c1", "s1")]).toEqual({ units: 8, daysBasis: false });
    expect(scoped.billed).toEqual(full.billed);
    expect(scoped.confirmedPrices).toEqual(full.confirmedPrices);
    for (const q of mocks.queries.filter((q) => q.table === "class_schedules" || q.table === "enrollments")) {
      expect(q.calls).toContainEqual(["eq", ["tenant_id", "tenant-1"]]);
      expect(q.calls).toContainEqual(["in", ["class_id", ["c1"]]]);
      expect(q.calls.some(([m]) => m === "range")).toBe(true);
    }
  });

  it("교시 조회 실패를 반 전체 등록 차수로 대체하지 않는다", async () => {
    mocks.errors.class_schedules = { message: "schedule unavailable" };
    await expect(getAttendanceClassBilledAmounts("2026-09", [{ classId: "c1", studentIds: ["s1"] }], {
      teacherScope: { teacherId: "home", classIds: ["c1"], holidays: [] },
    })).rejects.toThrow("schedule unavailable");
  });

  it("강사도 허용된 반의 매칭 금액을 읽으며 월·테넌트·학생으로 한정한다 — 금액은 void 제외 청구서로만", async () => {
    const { billed: result } = await getAttendanceClassBilledAmounts("2026-09", [
      { classId: "c1", studentIds: ["s1", "s2"] }, { classId: "forbidden", studentIds: ["other"] },
    ]);
    // s2의 청구서는 취소(void)라 금액을 만들지 않는다 — 종전 `neq status void`와 같은 결과.
    expect(result).toEqual({ [rowKey("c1", "s1")]: 210000 });
    expect(mocks.access).toHaveBeenCalledWith("attendance");
    expect(mocks.visible).toHaveBeenCalledWith("2026-09-01", "2026-09-30");
    expect(mocks.queries[0]!.calls).toEqual(expect.arrayContaining([
      ["eq", ["tenant_id", "tenant-1"]], ["eq", ["period", "2026-09"]], ["in", ["student_id", ["s1", "s2"]]],
    ]));
    // 🔴 취소분도 읽는다(2026-09-18) — `status`를 select하고 `neq status void`는 없다("없음"과 "취소"를 가르는 재료).
    expect(mocks.queries[0]!.calls).not.toEqual(expect.arrayContaining([["neq", ["status", "void"]]]));
    expect(mocks.queries[0]!.calls.find(([m]) => m === "select")![1][0]).toContain("status");
    // 회차 행은 **살아 있는 청구서**(i1)만 — 취소된 i2의 회차 행은 안 읽는다.
    expect(mocks.queries[1]!.calls).toEqual(expect.arrayContaining([
      ["eq", ["tenant_id", "tenant-1"]], ["in", ["invoice_id", ["i1"]]],
    ]));
  });

  it("학생별 청구서 상태 — 살아 있으면 ok · 취소뿐이면 void · 없으면 none(허용된 반의 학생 전원에게 키가 선다)", async () => {
    const { invoiceStateByStudent, billed } = await getAttendanceClassBilledAmounts("2026-09", [
      { classId: "c1", studentIds: ["s1", "s2", "s3"] }, { classId: "forbidden", studentIds: ["other"] },
    ]);
    expect(invoiceStateByStudent).toEqual({ s1: "ok", s2: "void", s3: "none" });
    // 허용되지 않은 반의 학생은 판정하지 않는다(키 없음 = 종전 '미확정').
    expect(invoiceStateByStudent).not.toHaveProperty("other");
    expect(billed).toEqual({ [rowKey("c1", "s1")]: 210000 });
  });

  it("허용된 반이 없으면 청구서를 조회하지 않는다", async () => {
    expect(await getAttendanceClassBilledAmounts("2026-09", [{ classId: "forbidden", studentIds: ["s1"] }])).toEqual({
      billed: {}, confirmedSessions: {}, confirmedPrices: {}, priceConfirmed: [], invoiceStateByStudent: {},
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("접근 권한 검증이 실패하면 관리자 조회를 하지 않는다", async () => {
    mocks.access.mockRejectedValue(new Error("access denied"));
    await expect(getAttendanceClassBilledAmounts("2026-09", [{ classId: "c1", studentIds: ["s1"] }])).rejects.toThrow("access denied");
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

/**
 * 보이지 않는 '보강' 반(0241a) — 강사 축(활성 반만) 밖이라 종전엔 청구 판정에서 통째로 빠져 확정한 뒤에도 '미확정'이었다(2026-09-18).
 * 출석부 page가 스스로 푼 보강 반 id만 `allowClassIds`로 넘긴다.
 */
describe("허용 반(allowClassIds) — 출석부 보강 묶음", () => {
  const POOL_NAME = "보강 (김선생)";
  const usePoolData = () => {
    mocks.tables.classes = [{ id: "pool", class_name: POOL_NAME }];
    mocks.tables.invoices = [
      // 반 이름 매칭은 **DB의 원래 반 이름**으로 한다(묶음 제목 '보강'이 아니라) — 회차 확정 화면과 같은 재료.
      { id: "i1", student_id: "s1", status: "issued", line_items: [{ description: POOL_NAME, amount: 45000 }] },
      { id: "i2", student_id: "s2", status: "void", line_items: [] },
    ];
    mocks.tables.invoice_session_terms = [
      {
        id: "t2", invoice_id: "i1", class_id: "pool", amount: null, confirmed_sessions: 2, unit_price: 22500,
        quantity_basis: "attendance_units", pricing_mode: "per_session", allocation_line_index: null,
      },
    ];
  };

  it("강사 축 밖의 보강 반도 청구액·등록 차수·「단가」·청구서 상태를 받는다", async () => {
    usePoolData();
    const result = await getAttendanceClassBilledAmounts(
      "2026-09",
      [{ classId: "pool", studentIds: ["s1", "s2", "s3"] }],
      { allowClassIds: ["pool"] },
    );
    expect(result.billed).toEqual({ [rowKey("pool", "s1")]: 45000 });
    expect(result.confirmedSessions).toEqual({ [rowKey("pool", "s1")]: { units: 2, daysBasis: false } });
    expect(result.priceConfirmed).toEqual([rowKey("pool", "s1")]);
    expect(result.confirmedPrices).toEqual({ [rowKey("pool", "s1")]: [{ unitPrice: 22500, monthly: false, daysBasis: false }] });
    expect(result.invoiceStateByStudent).toEqual({ s1: "ok", s2: "void", s3: "none" });
    // 보강 반만 묻는 호출은 강사 축을 볼 필요가 없다(담당 반 조회와 나란히 도는 두 번째 조회라 왕복을 줄인다).
    expect(mocks.visible).not.toHaveBeenCalled();
    // 🔴 이중 방어 — 이 테넌트의 **보강 반**인지 DB에서 다시 확인한다.
    const classesQuery = mocks.queries.find((q) => q.table === "classes")!;
    expect(classesQuery.calls).toEqual(expect.arrayContaining([
      ["eq", ["tenant_id", "tenant-1"]], ["eq", ["is_makeup_pool", true]], ["in", ["id", ["pool"]]],
    ]));
  });

  it("허용 목록에 없는 비활성 반은 종전대로 걸러진다 — 허용 반과 한 번에 물어도", async () => {
    usePoolData();
    const result = await getAttendanceClassBilledAmounts(
      "2026-09",
      [{ classId: "pool", studentIds: ["s1"] }, { classId: "inactive", studentIds: ["s9"] }],
      { allowClassIds: ["pool"] },
    );
    // 허용 반 밖이 섞이면 강사 축을 본다 — 거기 없는 `inactive`는 판정 대상이 아니다.
    expect(mocks.visible).toHaveBeenCalledWith("2026-09-01", "2026-09-30");
    expect(result.invoiceStateByStudent).toEqual({ s1: "ok" });
    expect(result.invoiceStateByStudent).not.toHaveProperty("s9");
    // 반 이름 확인도 허용 목록에 든 id만 묻는다.
    expect(mocks.queries.find((q) => q.table === "classes")!.calls).toEqual(expect.arrayContaining([["in", ["id", ["pool"]]]]));
  });

  it("DB가 보강 반이라고 확인해 주지 않으면(다른 반 id를 넘김) 받지 않는다", async () => {
    usePoolData();
    mocks.tables.classes = []; // `is_makeup_pool` 조건에 안 걸렸다
    const result = await getAttendanceClassBilledAmounts("2026-09", [{ classId: "other", studentIds: ["s1"] }], {
      allowClassIds: ["other"],
    });
    expect(result).toEqual({ billed: {}, confirmedSessions: {}, confirmedPrices: {}, priceConfirmed: [], invoiceStateByStudent: {} });
    expect(mocks.queries.some((q) => q.table === "invoices")).toBe(false);
  });

  it("보강 반 이름 조회가 실패하면 그 반만 빠진다(fail-soft) — 담당 반 판정은 그대로", async () => {
    mocks.errors.classes = { message: "boom" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await getAttendanceClassBilledAmounts(
      "2026-09",
      [{ classId: "c1", studentIds: ["s1"] }, { classId: "pool", studentIds: ["s7"] }],
      { allowClassIds: ["pool"] },
    );
    expect(result.billed).toEqual({ [rowKey("c1", "s1")]: 210000 });
    expect(result.invoiceStateByStudent).toEqual({ s1: "ok" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("청구 판정 합치기(mergeAttendanceClassBilling)", () => {
  it("담당 반과 보강 반 두 벌을 한 벌로 — 줄 키는 그대로, 「단가」 줄은 합집합", () => {
    const merged = mergeAttendanceClassBilling(
      {
        billed: { [rowKey("c1", "s1")]: 210000 },
        confirmedSessions: { [rowKey("c1", "s1")]: { units: 8, daysBasis: false } },
        confirmedPrices: {},
        priceConfirmed: [rowKey("c1", "s1")],
        invoiceStateByStudent: { s1: "ok", s2: "none" },
      },
      {
        billed: { [rowKey("pool", "s1")]: 45000 },
        confirmedSessions: { [rowKey("pool", "s1")]: { units: 2, daysBasis: false } },
        confirmedPrices: {},
        priceConfirmed: [rowKey("pool", "s1"), rowKey("c1", "s1")],
        invoiceStateByStudent: { s1: "ok", s3: "void" },
      },
    );
    expect(merged.billed).toEqual({ [rowKey("c1", "s1")]: 210000, [rowKey("pool", "s1")]: 45000 });
    expect(merged.confirmedSessions).toEqual({
      [rowKey("c1", "s1")]: { units: 8, daysBasis: false },
      [rowKey("pool", "s1")]: { units: 2, daysBasis: false },
    });
    expect([...merged.priceConfirmed].sort()).toEqual([rowKey("c1", "s1"), rowKey("pool", "s1")].sort());
    expect(merged.invoiceStateByStudent).toEqual({ s1: "ok", s2: "none", s3: "void" });
  });

  it("같은 줄이 두 벌에 있으면 더하지 않는다(같은 청구서를 두 번 읽은 같은 사실) · 학생 상태가 갈리면 살아 있는 쪽", () => {
    const key = rowKey("c1", "s1");
    const base = { confirmedSessions: {}, confirmedPrices: {}, priceConfirmed: [] };
    const merged = mergeAttendanceClassBilling(
      { ...base, billed: { [key]: 1000 }, invoiceStateByStudent: { s1: "none", s2: "ok" } },
      { ...base, billed: { [key]: 1000 }, invoiceStateByStudent: { s1: "ok", s2: "void" } },
    );
    expect(merged.billed).toEqual({ [key]: 1000 });
    expect(merged.invoiceStateByStudent).toEqual({ s1: "ok", s2: "ok" });
  });
});
