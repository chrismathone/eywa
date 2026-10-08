import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ manager: vi.fn(), sql: vi.fn(), configuration: vi.fn(), report: vi.fn() }));
vi.mock("./security", () => ({
  AgentError: class extends Error { constructor(public status: number, public code: string) { super(code); } },
  requireManager: h.manager, generateCode: vi.fn(), privateHash: vi.fn(), rateLimit: vi.fn(),
}));
vi.mock("./db", () => ({ agentDb: () => h.sql }));
vi.mock("./control", () => ({ deviceConfiguration: h.configuration }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: h.report }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { getAgentDashboard } from "./actions";
import { AgentError } from "./security";

beforeEach(() => {
  vi.clearAllMocks();
  h.manager.mockResolvedValue({ id: "actor", tenantId: "verified-tenant", systemRole: "master" });
  h.configuration.mockResolvedValue({ revision: 1, enabled: true, classnoteEnabled: true, makeeduEnabled: true, updatesEnabled: true, cutoverReady: false });
  h.sql.mockImplementation(async (parts: TemplateStringsArray) => parts.join("").includes("select version,installer_url") ? [{ version: "1.0.1", installer_url: "https://files.example/app.exe" }] : []);
});
describe("agent dashboard failures", () => {
  it("returns the published installer and actual configuration after a successful query", async () => {
    const result = await getAgentDashboard();
    expect(result.data?.release).toEqual({ version: "1.0.1", url: "https://files.example/app.exe" });
    expect(result.data?.configuration.enabled).toBe(true);
    expect(h.configuration).toHaveBeenCalledWith({ id: "", tenantId: "verified-tenant" });
    expect(h.report).not.toHaveBeenCalled();
  });
  it("reports connection saturation without exposing database credentials or SQL", async () => {
    h.sql.mockRejectedValue(Object.assign(new Error("(EMAXCONNSESSION) max clients reached password=fixture-private-value SQL: select sensitive"), { code: "XX000" }));
    const result = await getAgentDashboard();
    expect(result.error).toBe("연동 서버의 연결이 혼잡합니다. 잠시 후 새로고침해 주세요.");
    expect(h.report.mock.calls[0][1]).toEqual({ scope: "sync-agent.action", code: "XX000", category: "connection_limit" });
    const logged = String(h.report.mock.calls[0][0]) + JSON.stringify(h.report.mock.calls[0][1]);
    expect(logged).not.toContain("fixture-private-value");
    expect(logged).not.toContain("select sensitive");
  });
  it("keeps unknown errors private while recording a bounded diagnostic code", async () => {
    h.sql.mockRejectedValue(Object.assign(new Error("SQL and private parameters"), { code: "42P01" }));
    const result = await getAgentDashboard();
    expect(result.error).toBe("처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    expect(h.report.mock.calls[0][1]).toMatchObject({ code: "42P01", category: "unexpected" });
  });
  it("rejects an unauthorized actor before querying PC state or releases", async () => {
    h.manager.mockRejectedValue(new AgentError(403, "권한을 확인해 주세요."));
    expect(await getAgentDashboard()).toEqual({ error: "권한을 확인해 주세요." });
    expect(h.sql).not.toHaveBeenCalled();
    expect(h.configuration).not.toHaveBeenCalled();
  });
});
