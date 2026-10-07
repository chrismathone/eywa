import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const access = vi.hoisted(() => ({ require: vi.fn() }));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: access.require }));
vi.mock("@/features/payroll/server/salary-access", () => ({ canReadSalary: async () => false }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: async () => true, canManageTenant: async () => false }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ modules: { disabled: [] } }) }));
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`); } }));
vi.mock("./_components/billing-content", () => ({ BillingContent: () => null }));
vi.mock("./_components/textbooks-face", () => ({ TextbooksFace: () => null }));
vi.mock("./_components/expenses-panel", () => ({ ExpensesPanel: () => null }));
vi.mock("./_components/calculator-panel", () => ({ CalculatorPanel: () => null }));
vi.mock("./_components/refunds-face", () => ({ RefundsFace: () => null }));
vi.mock("./_components/teacher-settlement-face", () => ({ TeacherSettlementFace: () => null }));
vi.mock("./_components/session-terms-face", () => ({ SessionTermsFace: ({ panel, status }: { panel?: string; status?: string }) => <div data-testid="session-face">{panel}:{status}</div> }));
vi.mock("@/components/makeedu-sync-badge", () => ({ MakeeduSyncBadge: () => null }));
vi.mock("@/components/face-tabs", () => ({ FaceTabs: ({ faces }: { faces: { label: string; href: string }[] }) => <nav>{faces.map((face) => <a key={face.href} href={face.href}>{face.label}</a>)}</nav> }));
import BillingPage, { generateMetadata } from "./page";
beforeEach(() => { access.require.mockResolvedValue({ systemRole: "admin" }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("authenticates old verification URLs before redirecting and preserves filters", async () => {
  await expect(BillingPage({ searchParams: Promise.resolve({ tab: "verify", period: "2026-09", status: "over", subject: "math", embed: "1" }) }))
    .rejects.toThrow("redirect:/billing?tab=sessions&period=2026-09&status=over&subject=math&embed=1&panel=verify");
  expect(access.require).toHaveBeenCalledWith("billing");
  access.require.mockRejectedValue(new Error("access-denied"));
  await expect(BillingPage({ searchParams: Promise.resolve({ tab: "verify" }) })).rejects.toThrow("access-denied");
});
it("opens the comparison inside sessions without an independent verification tab", async () => {
  render(await BillingPage({ searchParams: Promise.resolve({ tab: "sessions", panel: "verify", status: "short" }) }));
  expect(screen.getByTestId("session-face")).toHaveTextContent("verify:short");
  expect(screen.getByRole("link", { name: "회차 확정" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "시수 검증" })).toBeNull();
  expect((await generateMetadata({ searchParams: Promise.resolve({ tab: "sessions", panel: "verify" }) })).title).toContain("청구 시수 대조");
});
