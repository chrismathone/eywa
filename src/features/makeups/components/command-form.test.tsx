import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CommandForm } from "./command-form";
import { CaseDetailReloadContext } from "./case-detail-context";

const calls = vi.hoisted(() => ({ execute: vi.fn(), refresh: vi.fn(), saved: vi.fn(), publish: vi.fn(), reload: vi.fn(), onSaved: vi.fn(), notice: vi.fn() }));
vi.mock("sonner", () => ({ toast: { message: calls.notice } }));
vi.mock("../server/actions", () => ({ executeMakeupCommand: calls.execute }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: calls.refresh }) }));
vi.mock("@/components/workspace/use-unsaved-guard", () => ({ useUnsavedGuard: () => ({ markSaved: calls.saved }) }));
vi.mock("@/lib/realtime/mutation-signal", () => ({ publishMutation: calls.publish }));

function form(revision: number, props: { refresh?: "server" | "client"; onSaved?: (result: Record<string, unknown>) => void } = {}) {
  return <CommandForm action="assign" revision={revision} label="담당 저장" {...props}
    payload={data => ({ case_id: "case-a", owner_id: data.get("owner") })}>
    <label>담당<input name="owner" defaultValue="staff-a" /></label>
  </CommandForm>;
}
function mount(revision = 4) {
  return render(form(revision));
}
const inDetail = () => render(<CaseDetailReloadContext value={{ reload: calls.reload }}>{form(4)}</CaseDetailReloadContext>);
const submit = () => fireEvent.click(screen.getByRole("button", { name: "담당 저장" }));
describe("명령 재시도와 변경 보호", () => {
  beforeEach(() => vi.resetAllMocks());
  it("저장 응답을 잃어도 같은 명령 ID로 확인하고 성공 뒤에만 갱신한다", async () => {
    calls.execute.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ ok: true, result: { revision: 5 } });
    mount(); submit();
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "담당 저장" })).toBeEnabled());
    const first = calls.execute.mock.calls[0][0];
    expect(first.expected_revision).toBe(4);
    expect(calls.saved).not.toHaveBeenCalled();
    expect(calls.refresh).not.toHaveBeenCalled();
    submit(); await waitFor(() => expect(calls.saved).toHaveBeenCalledOnce());
    expect(calls.execute.mock.calls[1][0]).toEqual(first);
    await waitFor(() => expect(screen.getByRole("button", { name: "담당 저장" })).toBeEnabled());
    expect(calls.refresh).not.toHaveBeenCalled();
  });
  it("실패 후 내용이 달라지면 충돌하는 이전 명령 ID를 재사용하지 않는다", async () => {
    calls.execute.mockResolvedValue({ ok: false, error: "변경된 기록입니다", code: "stale_revision" });
    mount(); submit(); await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "담당 저장" })).toBeEnabled());
    const firstId = calls.execute.mock.calls[0][0].command_id;
    fireEvent.change(screen.getByRole("textbox", { name: "담당" }), { target: { value: "staff-b" } });
    submit(); await waitFor(() => expect(calls.execute).toHaveBeenCalledTimes(2));
    expect(calls.execute.mock.calls[1][0].command_id).not.toBe(firstId);
    expect(calls.execute.mock.calls[1][0].payload.owner_id).toBe("staff-b");
    expect(calls.saved).not.toHaveBeenCalled();
  });
  it("요청 중에는 입력과 반복 제출을 잠근다", async () => {
    let finish!: (value: unknown) => void;
    calls.execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mount(); submit();
    await screen.findByRole("button", { name: "처리 중…" });
    expect(screen.getByRole("textbox", { name: "담당" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "처리 중…" })).toBeDisabled();
    finish({ ok: true, result: {} });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "담당" })).toBeEnabled());
    expect(calls.saved).toHaveBeenCalledOnce();
  });
  it("명령 저장과 반영 실패를 함께 표시하여 완료로 오인하지 않게 한다", async () => {
    calls.execute.mockResolvedValue({ ok: true, result: { projection_state: "failed" } });
    mount(); submit();
    await screen.findByText(/저장했습니다 · 출결·시수 반영을 확인하지 못했습니다/);
    // The saved baseline is taken once the form is enabled again (post-commit), not inside the pending transition.
    await waitFor(() => expect(calls.saved).toHaveBeenCalledOnce());
  });
  it("반 복구 저장과 관측 확인을 구별하고 실제 출결·시수 변경으로 안내하지 않는다", async () => {
    calls.execute.mockResolvedValue({ ok: true, result: { anchor_verification: { state: "done", ok: true } } });
    mount(); submit();
    await screen.findByText(/출결·시수 값은 자동 변경하지 않았습니다/);
    expect(calls.notice).toHaveBeenCalledWith(expect.stringMatching(/자동 변경하지 않았습니다/));
    await waitFor(() => expect(calls.saved).toHaveBeenCalledOnce());
  });
  it("아직 출결이 없는 회차의 정상 복구를 복구할 문제가 있는 것처럼 안내하지 않는다", async () => {
    calls.execute.mockResolvedValue({ ok: true, result: { anchor_verification: { state: "pending", ok: false, code: "attendance_missing" } } });
    mount(); submit();
    await screen.findByText(/아직 출결 기록이 없으며/);
    expect(calls.notice).toHaveBeenCalledWith(expect.stringMatching(/실제 실시 후/));
    expect(calls.notice.mock.calls[0][0]).not.toMatch(/대사·복구에서 확인/);
  });
});

describe("저장 뒤 화면 갱신 — 페이지 재렌더 대신 건 데이터를 다시 읽는다", () => {
  beforeEach(() => vi.resetAllMocks());
  it("목록처럼 상세 문맥이 없으면 종전대로 서버 재검증을 요청하고 신호를 따로 보내지 않는다", async () => {
    calls.execute.mockResolvedValue({ ok: true, result: {} });
    mount(); submit();
    await waitFor(() => expect(calls.saved).toHaveBeenCalledOnce());
    expect(calls.execute.mock.calls[0][1]).toEqual({ refresh: "server" });
    expect(calls.publish).not.toHaveBeenCalled();
  });
  it("상세 화면 명령은 재검증 없이 저장하고, 다시 읽기가 끝날 때까지 처리 중을 유지한다", async () => {
    let loaded!: (value: boolean) => void;
    calls.execute.mockResolvedValue({ ok: true, result: { revision: 5 } });
    calls.reload.mockImplementation(() => new Promise(resolve => { loaded = resolve; }));
    inDetail(); submit();
    await waitFor(() => expect(calls.reload).toHaveBeenCalledOnce());
    expect(calls.execute.mock.calls[0][1]).toEqual({ refresh: "client" });
    expect(calls.publish).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "처리 중…" })).toBeDisabled();
    expect(calls.saved).not.toHaveBeenCalled();
    loaded(true);
    await screen.findByText("저장했습니다");
    await waitFor(() => expect(calls.saved).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "담당 저장" })).toBeEnabled();
  });
  it("다시 읽기에 실패하면 저장은 성공으로 두되 새로고침 경고를 띄우고, 같은 내용 재시도는 같은 명령 ID로 확인한다", async () => {
    calls.execute.mockResolvedValue({ ok: true, result: { projection_state: "pending" } });
    calls.reload.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    inDetail(); submit();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/저장했습니다 · 출결·시수 반영은 대기 중입니다.* 바뀐 내용을 불러오지 못했습니다/);
    await waitFor(() => expect(screen.getByRole("button", { name: "담당 저장" })).toBeEnabled());
    submit();
    await waitFor(() => expect(calls.reload).toHaveBeenCalledTimes(2));
    expect(calls.execute.mock.calls[1][0].command_id).toBe(calls.execute.mock.calls[0][0].command_id);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
  it("응답 전 연속 클릭은 한 번만 보낸다(상태 갱신 전에도 잠긴다)", async () => {
    let finish!: (value: unknown) => void;
    calls.execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    calls.reload.mockResolvedValue(true);
    inDetail();
    const form = screen.getByRole("button", { name: "담당 저장" }).closest("form")!;
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(calls.execute).toHaveBeenCalledOnce());
    finish({ ok: true, result: {} });
    await waitFor(() => expect(calls.saved).toHaveBeenCalledOnce());
    expect(calls.execute).toHaveBeenCalledOnce();
  });
  it("저장 직후 폼이 화면에서 빠져도 성공 콜백은 정확히 한 번 실행된다", async () => {
    let finish!: (value: unknown) => void;
    calls.execute.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(form(4, { refresh: "client", onSaved: calls.onSaved })); submit();
    await screen.findByRole("button", { name: "처리 중…" });
    finish({ ok: true, result: { case_id: "case-b" } });
    await waitFor(() => expect(calls.onSaved).toHaveBeenCalledOnce());
    view.unmount();
    expect(calls.onSaved).toHaveBeenCalledOnce();
  });
  it("성공 뒤 이동하는 폼은 재검증 없이 저장하고 다시 읽지 않고 바로 이동 콜백을 부른다", async () => {
    calls.execute.mockResolvedValue({ ok: true, result: { case_id: "case-b" } });
    render(form(4, { refresh: "client", onSaved: calls.onSaved })); submit();
    await waitFor(() => expect(calls.onSaved).toHaveBeenCalledWith({ case_id: "case-b" }));
    expect(calls.execute.mock.calls[0][1]).toEqual({ refresh: "client" });
    expect(calls.publish).toHaveBeenCalledOnce();
    expect(calls.reload).not.toHaveBeenCalled();
  });
  it("저장 기준 스냅샷은 입력이 다시 열린 뒤에 잡는다(잠긴 칸은 FormData에서 빠진다)", async () => {
    let enabledAtSave: boolean | undefined;
    calls.saved.mockImplementation(() => { enabledAtSave = !(screen.getByRole("textbox", { name: "담당" }) as HTMLInputElement).disabled; });
    calls.execute.mockResolvedValue({ ok: true, result: {} });
    calls.reload.mockResolvedValue(true);
    inDetail(); submit();
    await waitFor(() => expect(calls.saved).toHaveBeenCalledOnce());
    expect(enabledAtSave).toBe(true);
  });
});
