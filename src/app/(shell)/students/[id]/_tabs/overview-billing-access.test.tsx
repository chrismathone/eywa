import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";

const invoiceQuery = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/features/students/server/queries", () => ({
  getStudentAttendanceStats: async () => ({ total: 0, present: 0, absent: 0, late: 0, rate: 0 }),
  getStudentEnrollments: async () => [], getStudentInvoices: invoiceQuery,
  getStudentConsultationHistory: async () => [], getStudentMemos: async () => [],
}));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => DEFAULT_SETTINGS }));
vi.mock("@/features/teacher-view/server/lang", () => ({ getTeacherViewLang: async () => "ko" }));
vi.mock("@/features/teacher-view/server/teacher-names", () => ({ getTeacherEnglishNames: async () => ({}) }));
vi.mock("@/features/grades/unified/server/student-records", () => ({ getStudentUnifiedRows: async () => [] }));
vi.mock("../_components/tab-link", () => ({ TabLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
import { OverviewTab } from "./overview-tab";
import type { StudentDetail } from "@/features/students/server/queries";
const student = { id: "student", aiCareSummary: null, createdAt: "2026-10-03T00:00:00Z" } as StudentDetail;
beforeEach(() => invoiceQuery.mockClear());
afterEach(cleanup);

describe("학생 개요 수납 권한", () => {
  it("권한이 없으면 조회·카드·죽은 링크 모두 생략한다", async () => {
    render(await OverviewTab({ student, canSeeBilling: false }));
    expect(invoiceQuery).not.toHaveBeenCalled();
    expect(screen.queryByText("수납 현황")).toBeNull();
    expect(screen.queryByText("청구 내역 없음")).toBeNull();
    expect(document.querySelector('a[href$="tab=billing"]')).toBeNull();
  });
  it("조회 권한이 있으면 기존 수납 카드와 링크를 유지한다", async () => {
    render(await OverviewTab({ student, canSeeBilling: true }));
    expect(invoiceQuery).toHaveBeenCalledExactlyOnceWith("student");
    expect(screen.getByText("수납 현황")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "수납" })).toHaveAttribute("href", "/students/student?tab=billing");
  });
});
