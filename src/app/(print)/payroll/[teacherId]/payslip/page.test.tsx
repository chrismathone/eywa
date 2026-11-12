import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { resolveSettings } from "@/features/owner/resolve";

const m = vi.hoisted(() => ({ manage: false, view: true, payrollOn: true }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: () => { throw new Error("redirect"); },
  notFound: () => { throw new Error("notFound"); },
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "viewer", tenantId: "tenant", systemRole: "admin" }) }));
vi.mock("@/lib/auth/teacher-home", () => ({ landingPath: async () => "/" }));
vi.mock("@/features/payroll/server/payslip-gate", () => ({ canViewPayslipNow: async () => m.view, canManagePayslipNow: async () => m.manage }));
vi.mock("@/features/payroll/server/payslip-queries", () => ({ getPayslipData: async () => ({
  tuitionBasis: "tier", teacher: { name: "synthetic", classes: [] }, adjustments: {}, settlement: {}, amounts: { netPay: 100 },
}) }));
vi.mock("@/features/attendance/server/queries", () => ({ getMonthlyAttendanceMatrix: vi.fn() }));
vi.mock("@/features/attendance/server/teacher-sheet", () => ({ loadTeacherSheet: vi.fn() }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => {
  const settings = resolveSettings(null, { name: "" });
  return { ...settings, modules: { ...settings.modules, disabled: m.payrollOn ? [] : ["payroll"] } };
} }));
vi.mock("@/app/(print)/enrollment/[id]/print/print-actions", () => ({ PrintActions: () => <button>인쇄</button> }));
vi.mock("./payslip-document", () => ({ PayslipDocument: () => <article>명세서 본문</article> }));
vi.mock("./attendance-appendix", () => ({ AttendanceAppendix: () => <article>출석부 별지</article> }));
vi.mock("./adjustments-editor", () => ({ AdjustmentsEditor: () => <form aria-label="명세서 관리"><button>조정 저장</button><button>발행</button><button>발행취소</button></form> }));
import PayslipPrintPage from "./page";

afterEach(() => { cleanup(); m.view = true; m.manage = false; m.payrollOn = true; });
const page = () => PayslipPrintPage({ params: Promise.resolve({ teacherId: "teacher" }), searchParams: Promise.resolve({ period: "2026-09" }) });
describe("actual print page permission boundary", () => {
  it("reader can print the document and appendix but receives no editor", async () => {
    render(await page());
    expect(screen.getByText("명세서 본문")).toBeInTheDocument();
    expect(screen.getByText("출석부 별지")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "인쇄" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "명세서 관리" })).not.toBeInTheDocument();
    for (const name of ["조정 저장", "발행", "발행취소"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });
  it("manager receives the previous full editor and print controls", async () => {
    m.manage = true;
    render(await page());
    expect(screen.getByRole("form", { name: "명세서 관리" })).toBeInTheDocument();
    for (const name of ["인쇄", "조정 저장", "발행", "발행취소"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  });
  it("denied view redirects before rendering private document data", async () => {
    m.view = false;
    await expect(page()).rejects.toThrow("redirect");
  });
  it("급여 기능이 없는 지점의 인쇄 주소는 권한 착지 대신 404다", async () => {
    m.payrollOn = false;
    m.view = false;
    await expect(page()).rejects.toThrow("notFound");
  });
});
