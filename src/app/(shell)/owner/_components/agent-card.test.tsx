import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ dashboard: vi.fn() }));
vi.mock("@/features/sync-agent/server/actions", () => ({ getAgentDashboard: h.dashboard, issueAgentCode: vi.fn(), issueAgentManagementCode: vi.fn(), revokeAgentDevice: vi.fn(), saveAgentSettings: vi.fn() }));
import { AgentCard } from "./agent-card";
const loaded = { data: { device: null, events: [], release: { version: "1.0.1", url: "https://files.example/installer.exe" }, configuration: { revision: 1, enabled: true, classnoteEnabled: true, makeeduEnabled: true, updatesEnabled: true, cutoverReady: false } } };
beforeEach(() => vi.clearAllMocks());
describe("agent dashboard rendering", () => {
  it("shows a pending lookup instead of claiming the installer has not been published", async () => {
    let resolve!: (value: typeof loaded) => void;
    h.dashboard.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<AgentCard classnoteOn makeeduOn />);
    expect(screen.getByText("다운로드 정보를 확인 중입니다.")).toBeInTheDocument();
    expect(screen.queryByText("설치 파일을 준비 중입니다.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "연결 코드 발급" })).toBeDisabled();
    await act(async () => resolve(loaded));
    expect(await screen.findByRole("link", { name: "Windows용 다운로드 · 1.0.1" })).toHaveAttribute("href", loaded.data.release.url);
  });
  it("shows failed queries without fabricating an unpublished release or empty PC state, then recovers", async () => {
    h.dashboard.mockResolvedValueOnce({ error: "연동 서버의 연결이 혼잡합니다. 잠시 후 새로고침해 주세요." }).mockResolvedValue(loaded);
    render(<AgentCard classnoteOn makeeduOn />);
    await screen.findByRole("alert");
    expect(screen.getByText("다운로드 정보를 불러오지 못했습니다. 아래 새로고침을 눌러 주세요.")).toBeInTheDocument();
    expect(screen.queryByText("설치 파일을 준비 중입니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("아직 연결된 PC가 없습니다.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "연결 코드 발급" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Windows용 다운로드 · 1.0.1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "연결 코드 발급" })).toBeEnabled();
  });
  it("handles a rejected network request without leaving the lookup pending", async () => {
    h.dashboard.mockRejectedValue(new Error("network disconnected"));
    render(<AgentCard classnoteOn makeeduOn />);
    expect(await screen.findByRole("alert")).toHaveTextContent("연동 PC 상태를 불러오지 못했습니다.");
    expect(screen.queryByText("다운로드 정보를 확인 중입니다.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "연결 코드 발급" })).toBeDisabled();
  });
});
