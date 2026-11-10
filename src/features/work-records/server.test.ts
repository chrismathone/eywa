import { beforeEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ gate: vi.fn(), read: vi.fn(), db: vi.fn(), eq: vi.fn(), or: vi.fn(), paged: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/menu-gate", () => ({ menuGate: m.gate }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.read }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.db }));
vi.mock("@/lib/supabase/batch", () => ({ fetchAllPaged: m.paged }));
import { loadWorkRecords, saveWorkRecord, workAccess } from "./server";

const gate = (systemRole: string, write: boolean, manage: boolean) => ({ user: { id: "author", tenantId: "tenant", systemRole }, superAdmin: false, write, manage, readAll: manage });
const doc = { template: "weekly", title: "주간 실행보고", date: "2026-11-02", plan: "", action: "", result: "", next: "", state: "draft", reviewNote: "" };
beforeEach(() => {
  vi.clearAllMocks();
  m.gate.mockResolvedValue(gate("teacher", true, false)); m.read.mockResolvedValue(true);
  const q = { select: vi.fn().mockReturnThis(), eq: m.eq.mockReturnThis(), or: m.or.mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn().mockResolvedValue({ data: [], error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  m.db.mockReturnValue({ from: () => q, rpc: m.rpc }); m.paged.mockImplementation(async (cb: (a: number, b: number) => unknown) => { await cb(0, 999); return []; });
  m.rpc.mockResolvedValue({ data: { id: "x", version: 1 }, error: null });
});
describe("업무 작성센터 — 개인 문서와 검토함의 서버 경계", () => {
  it("'업무 작성센터' 권한을 본다", async () => { await workAccess(); expect(m.gate).toHaveBeenCalledWith("work_records"); });
  it("강사는 자기 문서만 조회한다", async () => {
    const data = await loadWorkRecords(); expect(data.canReview).toBe(false);
    expect(m.eq).toHaveBeenCalledWith("tenant_id", "tenant"); expect(m.eq).toHaveBeenCalledWith("author_id", "author"); expect(m.or).not.toHaveBeenCalled();
  });
  it("관리자(권한 '전체')도 남의 초안은 받지 않는다", async () => {
    m.gate.mockResolvedValue(gate("manager", true, true));
    const data = await loadWorkRecords(); expect(data.canReview).toBe(true);
    expect(m.or).toHaveBeenCalledWith("author_id.eq.author,document->>state.in.(submitted,reviewed)");
  });
  it("'전체' 권한을 받은 강사도 검토자는 아니다", async () => { m.gate.mockResolvedValue(gate("teacher", true, true)); expect((await workAccess()).canReview).toBe(false); });
  it("권한 없음 · 열람·아르바이트 역할은 DB 전에 거절", async () => {
    m.gate.mockResolvedValue(null); await expect(workAccess()).rejects.toThrow();
    m.gate.mockResolvedValue(gate("viewer", true, true)); await expect(workAccess()).rejects.toThrow();
    m.gate.mockResolvedValue(gate("parttime", true, true)); await expect(workAccess()).rejects.toThrow();
    expect(m.db).not.toHaveBeenCalled();
  });
  it("읽기 권한(또는 열람 보기)이면 저장하지 않는다", async () => {
    m.gate.mockResolvedValue(gate("teacher", false, false));
    await expect(saveWorkRecord({ id: crypto.randomUUID(), requestId: crypto.randomUUID(), version: 0, action: "save", document: doc })).rejects.toThrow("작성 권한");
    expect(m.db).not.toHaveBeenCalled();
  });
  it("검토 권한 없이 검토 요청을 보내면 거절", async () => {
    await expect(saveWorkRecord({ id: crypto.randomUUID(), requestId: crypto.randomUUID(), version: 1, action: "review", document: { ...doc, state: "reviewed", reviewNote: "확인" } })).rejects.toThrow("검토할 권한");
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("지점 보기(읽기 전용) = 검토함은 읽되 검토는 못 한다", async () => {
    m.gate.mockResolvedValue({ ...gate("master", false, false), readAll: true });
    const data = await loadWorkRecords(); expect(data.seeReview).toBe(true); expect(data.canReview).toBe(false); expect(m.or).toHaveBeenCalled();
  });
  it("작성자 ID·지점은 서버가 채운다", async () => {
    const id = crypto.randomUUID();
    await saveWorkRecord({ id, requestId: crypto.randomUUID(), version: 0, action: "save", document: doc });
    expect(m.rpc).toHaveBeenCalledWith("save_academy_work_record", expect.objectContaining({ p_tenant: "tenant", p_actor: "author", p_id: id, p_review: false }));
  });
});
