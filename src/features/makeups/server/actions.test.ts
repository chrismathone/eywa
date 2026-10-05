import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ actor: vi.fn(), canWrite: vi.fn(), settings: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: deps.actor }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: deps.canWrite }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: deps.rpc }) }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: deps.settings }));
vi.mock("next/cache", () => ({ revalidatePath: deps.revalidate }));
vi.mock("./queries", () => ({ getMakeupCases: vi.fn(), getMakeupOptions: vi.fn(), getMakeupCaseDetail: deps.detail, getMakeupEvents: vi.fn() }));
import { executeMakeupCommand, reloadMakeupCaseDetail } from "./actions";

const id = "00000000-0000-4000-8000-000000000061";
const command = { command_id: "00000000-0000-4000-8000-000000000001", action: "approve",
  expected_revision: 2, payload: { case_id: id, target_minutes: 110, note: "승인 근거" } };
describe("보강 서버 명령의 권한·운영 게이트와 저장 응답", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    deps.actor.mockResolvedValue({ id, tenantId: id, systemRole: "admin" });
    deps.canWrite.mockResolvedValue(true);
    deps.settings.mockResolvedValue({ makeups: { mode: "on" } });
  });
  it("로그인과 현재 쓰기 권한이 없으면 DB 호출 전에 거절한다", async () => {
    deps.actor.mockResolvedValueOnce(null);
    expect((await executeMakeupCommand(command)).ok).toBe(false);
    deps.canWrite.mockResolvedValueOnce(false);
    expect((await executeMakeupCommand(command)).ok).toBe(false);
    expect(deps.rpc).not.toHaveBeenCalled();
  });
  it("꺼짐과 정리 상태 신규 접수는 API 요청으로도 열리지 않는다", async () => {
    deps.settings.mockResolvedValueOnce({ makeups: { mode: "off" } });
    expect((await executeMakeupCommand(command)).ok).toBe(false);
    deps.settings.mockResolvedValueOnce({ makeups: { mode: "draining" } });
    expect((await executeMakeupCommand({ ...command, action: "intake", expected_revision: null,
      payload: { student_id: id, subject_key: "math", reason: "additional", source_kind: "manual", source_id: id } })).ok).toBe(false);
    expect(deps.rpc).not.toHaveBeenCalled();
  });
  it("권한 변경은 다음 요청에 다시 검사하며 과거 승인이 호출을 열어주지 않는다", async () => {
    deps.rpc.mockResolvedValue({ data: null, error: null });
    await executeMakeupCommand(command);
    deps.canWrite.mockResolvedValueOnce(false);
    expect((await executeMakeupCommand(command)).ok).toBe(false);
    expect(deps.actor).toHaveBeenCalledTimes(2);
    expect(deps.rpc).toHaveBeenCalledOnce();
  });
  it("형식이 누락된 성공 응답은 성공·갱신으로 처리하지 않는다", async () => {
    deps.rpc.mockResolvedValue({ data: { id, revision: 3 }, error: null });
    const result = await executeMakeupCommand(command);
    expect(result.ok).toBe(false);
    expect(deps.revalidate).not.toHaveBeenCalled();
    expect(deps.rpc.mock.calls[0][1]).toMatchObject({ p_command_id: command.command_id, p_expected_revision: 2 });
  });
  it("오래된 개정 번호 오류를 유지하며 내부 상세 내용을 화면에 싣지 않는다", async () => {
    deps.rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "변경된 기록입니다. 새로고침 후 확인해 주세요.",
      details: JSON.stringify({ code: "stale_revision", current_revision: 3, internal: "hidden-debug-data" }) } });
    const result = await executeMakeupCommand(command);
    expect(result).toMatchObject({ ok: false, code: "stale_revision" });
    expect(JSON.stringify(result)).not.toContain("hidden-debug-data");
    expect(deps.revalidate).not.toHaveBeenCalled();
  });
});

const saved = { id: "11111111-1111-4111-8111-111111111111", revision: 3, replayed: false, effect_key: null,
  action: "approve", case_id: id, session_id: null, participant_id: null, fulfillment_id: null,
  case_ids: [], quantities: null, warnings: [] };
describe("저장 뒤 갱신 방식 — 클라이언트 갱신은 페이지를 다시 그리지 않는다", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    deps.actor.mockResolvedValue({ id, tenantId: id, systemRole: "admin" });
    deps.canWrite.mockResolvedValue(true);
    deps.settings.mockResolvedValue({ makeups: { mode: "on" } });
    deps.rpc.mockResolvedValue({ data: saved, error: null });
  });
  it("기본(서버 갱신)은 종전대로 관련 화면 경로를 재검증한다", async () => {
    expect((await executeMakeupCommand(command)).ok).toBe(true);
    expect(deps.revalidate).toHaveBeenCalledWith(`/makeups/${id}`);
    expect(deps.revalidate).toHaveBeenCalledWith("/attendance");
  });
  it("클라이언트 갱신은 같은 저장을 하되 재검증하지 않는다(응답에 페이지 트리가 실리지 않는다)", async () => {
    expect(await executeMakeupCommand(command, { refresh: "client" })).toEqual({ ok: true, result: saved });
    expect(deps.rpc).toHaveBeenCalledOnce();
    expect(deps.revalidate).not.toHaveBeenCalled();
  });
  it("알 수 없는 갱신 옵션은 서버 갱신으로 처리한다", async () => {
    await executeMakeupCommand(command, { refresh: "nothing" });
    expect(deps.revalidate).toHaveBeenCalled();
  });
  it("건 다시 읽기는 형식이 맞는 건 ID만 조회한다", async () => {
    expect(await reloadMakeupCaseDetail({ case_id: "not-a-case" })).toEqual({ error: "보강 건을 확인해 주세요" });
    expect(deps.detail).not.toHaveBeenCalled();
    deps.detail.mockResolvedValue({ data: { case: { id } } });
    expect(await reloadMakeupCaseDetail({ case_id: id })).toEqual({ data: { case: { id } } });
    expect(deps.detail).toHaveBeenCalledWith(id);
  });
});
