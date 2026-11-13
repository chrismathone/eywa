// 사용자 템플릿 — '내 템플릿'의 나는 강사뷰면 대상 강사 X다(원장 2026-11-05 강사뷰 전수).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(),
  readonly: vi.fn(),
  calls: [] as { op: string; args: unknown[] }[],
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/view-as", () => ({ readonlyTeacherViewError: m.readonly }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: vi.fn(async () => ({ modules: { disabled: [] } })) }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      for (const k of ["select", "eq", "order", "update", "insert", "delete"]) {
        q[k] = (...args: unknown[]) => { m.calls.push({ op: k, args }); return q; };
      }
      q.single = async () => ({ data: { id: "n1", name: "새 템플릿", body: "본문" }, error: null });
      q.maybeSingle = async () => ({ data: { id: "n1", name: "새 템플릿", body: "본문" }, error: null });
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return q;
    },
  }),
}));

import { deleteMyReportTemplate, listMyReportTemplates, saveMyReportTemplate } from "./actions";

const A = { id: "a1", tenantId: "t1", systemRole: "master" };
const X = { id: "x1", tenantId: "t1", systemRole: "teacher" };
const ownerFilters = () => m.calls.filter((c) => c.op === "eq" && c.args[0] === "owner_id").map((c) => c.args[1]);

beforeEach(() => {
  vi.clearAllMocks();
  m.calls = [];
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  m.readonly.mockResolvedValue(null);
});

describe("내 템플릿 — 강사뷰 신원", () => {
  it("🔴 목록은 대상 X의 템플릿(A의 템플릿이 X 화면에 뜨지 않는다)", async () => {
    await listMyReportTemplates();
    expect(ownerFilters()).toEqual(["x1"]);
  });

  it("🔴 새로 만들면 X 소유로 저장된다", async () => {
    const r = await saveMyReportTemplate({ name: "새 템플릿", body: "본문" });
    expect(r.ok).toBe(true);
    const insert = m.calls.find((c) => c.op === "insert");
    expect(insert?.args[0]).toMatchObject({ tenant_id: "t1", owner_id: "x1" });
  });

  it("수정·삭제도 X의 템플릿만", async () => {
    await saveMyReportTemplate({ id: "11111111-1111-4111-8111-111111111111", name: "새 템플릿", body: "본문" });
    await deleteMyReportTemplate("11111111-1111-4111-8111-111111111111");
    expect(ownerFilters()).toEqual(["x1", "x1"]);
  });

  it("열람 전용 강사뷰 — 목록은 X의 것을 보여 주고, 저장·삭제는 거절한다", async () => {
    m.readonly.mockResolvedValue("다른 강사 화면은 열람 전용입니다");
    const list = await listMyReportTemplates();
    expect(list.notice).toBeNull();
    expect(ownerFilters()).toEqual(["x1"]);
    expect(await saveMyReportTemplate({ name: "새 템플릿", body: "본문" })).toEqual({ ok: false, error: "다른 강사 화면은 열람 전용입니다" });
    expect(await deleteMyReportTemplate("11111111-1111-4111-8111-111111111111")).toEqual({ ok: false, error: "다른 강사 화면은 열람 전용입니다" });
    expect(m.calls.some((c) => c.op === "insert" || c.op === "delete" || c.op === "update")).toBe(false);
  });
});
