import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ actor: vi.fn(), access: vi.fn(), settings: vi.fn(), rpc: vi.fn() }));
vi.mock("react", () => ({ cache: (callback: unknown) => callback }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: deps.actor }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: deps.access }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: deps.settings }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: deps.rpc }) }));
import { getMakeupCases, getMakeupEvents, getMakeupReconciliation, getMakeupLegacyDryRun } from "./queries";

const id = "00000000-0000-4000-8000-000000000061";
const row = { id, revision: 1, student_id: id, student_name: "가상학생", subject_key: "math",
  original_class_id: null, original_class_name: null, original_date: null, reason: "imported",
  eligibility: "pending", lifecycle: "open", closure_reason: null, target_minutes: null,
  outstanding_minutes: null, committed_minutes: 120, reservable_minutes: null,
  owner_id: null, owner_name: null, due_date: null, next_session_date: null, next_action: "review",
  flags: ["pending"], imported_commitment: true, updated_at: "2026-10-05T00:00:00Z" };
const list = { mode: "on", total: 1001, page: 1, page_size: 30, rows: [row], counts: { active: 1001 }, last_success_at: "2026-10-05T00:00:00Z" };
describe("보강 조회 실패·범위·분량 표시", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    deps.actor.mockResolvedValue({ id, systemRole: "admin" });
    deps.access.mockResolvedValue(true); deps.settings.mockResolvedValue({ makeups: { mode: "on" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  it("권한 철회와 운영 꺼짐은 다음 조회에서 DB를 호출하지 않는다", async () => {
    deps.rpc.mockResolvedValue({ data: list, error: null });
    expect((await getMakeupCases({})).data?.total).toBe(1001);
    deps.access.mockResolvedValueOnce(false);
    expect((await getMakeupCases({})).error).toBeTruthy();
    deps.settings.mockResolvedValueOnce({ makeups: { mode: "off" } });
    expect((await getMakeupCases({})).error).toBeTruthy();
    expect(deps.rpc).toHaveBeenCalledOnce();
  });
  it("DB 오류와 응답 누락은 빈 목록이나 0건으로 바꾸지 않는다", async () => {
    deps.rpc.mockResolvedValueOnce({ data: null, error: { code: "08006", message: "연결 실패" } });
    expect(await getMakeupCases({})).toEqual({ error: "보강 기록을 불러오지 못했습니다. 다시 시도해 주세요." });
    deps.rpc.mockResolvedValueOnce({ data: { rows: [], total: 0 }, error: null });
    expect((await getMakeupCases({})).data).toBeUndefined();
  });
  it("승인 미정은 null, 음수 잔량은 그대로 보존하여 숨기지 않는다", async () => {
    deps.rpc.mockResolvedValueOnce({ data: list, error: null });
    expect((await getMakeupCases({})).data?.rows[0].outstanding_minutes).toBeNull();
    deps.rpc.mockResolvedValueOnce({ data: { ...list, rows: [{ ...row, outstanding_minutes: -30, reservable_minutes: -150 }] }, error: null });
    const result = await getMakeupCases({});
    expect(result.data?.rows[0]).toMatchObject({ outstanding_minutes: -30, reservable_minutes: -150 });
  });
  it("변경 이력은 케이스와 페이지를 서버 범위 조회로 전달한다", async () => {
    deps.rpc.mockResolvedValue({ data: { rows: [], total: 1001, page: 3, page_size: 50 }, error: null });
    expect((await getMakeupEvents(id, 3)).data?.total).toBe(1001);
    expect(deps.rpc).toHaveBeenCalledWith("makeup_case_events", { p_case_id: id, p_filter: { page: 3, page_size: 50 } });
  });
  it("대사·반영 건수와 페이지가 없는 응답은 완료나 0건으로 표시하지 않는다", async () => {
    deps.rpc.mockResolvedValue({ data: { rows: [], projection_jobs: [], total: 0 }, error: null });
    expect((await getMakeupReconciliation({})).data).toBeUndefined();
  });
  it("사전 점검은 읽기 RPC만 호출하고 쓰기 발생·잘못된 등급 집계를 거절한다", async () => {
    const dryRun = { rows: [], total: 1001, page: 35, page_size: 30, writes: 0,
      counts: { A: 1000, B: 1, C: 0, D: 0, E: 0 } };
    deps.rpc.mockResolvedValueOnce({ data: dryRun, error: null });
    expect((await getMakeupLegacyDryRun({ page: 35 })).data?.total).toBe(1001);
    expect(deps.rpc).toHaveBeenCalledWith("makeup_legacy_dry_run", { p_filter: { page: 35 } });
    deps.rpc.mockResolvedValueOnce({ data: { ...dryRun, writes: 1 }, error: null });
    expect((await getMakeupLegacyDryRun({})).error).toBeTruthy();
    deps.rpc.mockResolvedValueOnce({ data: { ...dryRun, total: 0 }, error: null });
    expect((await getMakeupLegacyDryRun({})).error).toBeTruthy();
  });
});
