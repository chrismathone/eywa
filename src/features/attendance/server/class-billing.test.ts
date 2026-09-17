import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(), visible: vi.fn(), from: vi.fn(), queries: [] as { table: string; calls: [string, unknown[]][] }[],
}));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: mocks.access }));
vi.mock("./teacher-axis-queries", () => ({ loadVisibleClassAxisRows: mocks.visible }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));

import { getAttendanceClassBilledAmounts } from "./class-billing";
import { rowKey } from "../grid/model";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queries.length = 0;
  mocks.access.mockResolvedValue({ tenantId: "tenant-1", systemRole: "teacher" });
  mocks.visible.mockResolvedValue([{ id: "c1", className: "고등M TP4E" }]);
  mocks.from.mockImplementation((table: string) => {
    const query = { table, calls: [] as [string, unknown[]][] };
    mocks.queries.push(query);
    const data = table === "invoices"
      ? [{ id: "i1", student_id: "s1", line_items: [{ description: "고등M TP4E", amount: 210000 }] }]
      : [{ id: "t1", invoice_id: "i1", class_id: "c1", amount: null, confirmed_sessions: null, allocation_line_index: null }];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "in", "order", "range"]) {
      builder[method] = (...args: unknown[]) => { query.calls.push([method, args]); return builder; };
    }
    builder.then = (resolve: (result: unknown) => unknown) => Promise.resolve(resolve({ data, error: null }));
    return builder;
  });
});

describe("강사 출석부 청구액 조회 범위", () => {
  it("강사도 허용된 반의 매칭 금액을 읽으며 월·테넌트·학생 및 void 제외를 적용한다", async () => {
    const result = await getAttendanceClassBilledAmounts("2026-09", [
      { classId: "c1", studentIds: ["s1"] }, { classId: "forbidden", studentIds: ["other"] },
    ]);
    expect(result).toEqual({ [rowKey("c1", "s1")]: 210000 });
    expect(mocks.access).toHaveBeenCalledWith("attendance");
    expect(mocks.visible).toHaveBeenCalledWith("2026-09-01", "2026-09-30");
    expect(mocks.queries[0]!.calls).toEqual(expect.arrayContaining([
      ["eq", ["tenant_id", "tenant-1"]], ["eq", ["period", "2026-09"]],
      ["neq", ["status", "void"]], ["in", ["student_id", ["s1"]]],
    ]));
    expect(mocks.queries[1]!.calls).toEqual(expect.arrayContaining([
      ["eq", ["tenant_id", "tenant-1"]], ["in", ["invoice_id", ["i1"]]],
    ]));
  });

  it("허용된 반이 없으면 청구서를 조회하지 않는다", async () => {
    expect(await getAttendanceClassBilledAmounts("2026-09", [{ classId: "forbidden", studentIds: ["s1"] }])).toEqual({});
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("접근 권한 검증이 실패하면 관리자 조회를 하지 않는다", async () => {
    mocks.access.mockRejectedValue(new Error("access denied"));
    await expect(getAttendanceClassBilledAmounts("2026-09", [{ classId: "c1", studentIds: ["s1"] }])).rejects.toThrow("access denied");
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
