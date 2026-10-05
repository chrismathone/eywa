import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 설정 화면의 작은 정리 둘(2026-10-06).
 *  ① 데이터 가져오기 — 이 학원에서 **끈 기능**의 줄은 세우지 않는다. 줄을 세워 두고 "권한이 없습니다"라고 적으면
 *     그 기능이 있다는 것을 알리는 셈이다(끈 기능은 있었는지조차 모르게). 켜져 있고 권한만 없는 줄은 그대로 선다.
 *  ② 과목 운영의 '월간 계획서 인쇄 문구' — 그 값을 읽는 화면(영어 강사 시트의 월간 계획서)이 있는 과목에만 편집 칸을 세운다.
 *     다른 과목에 세우면 적어도 어디에도 안 나오는 칸이 된다(저장만 되고 쓰이지 않는 설정).
 */
const m = vi.hoisted(() => ({
  user: { id: "u", tenantId: "t", systemRole: "master" } as { id: string; tenantId: string; systemRole: string } | null,
  disabled: [] as string[],
  manageable: new Set<string>(),
  ecsOn: true,
}));
// 줄마다의 메뉴 — 실제 가져오기 정의(importers/*.ts)의 `menu`와 같다.
const MENU_OF: Record<string, string> = {
  students: "students",
  staff: "staff",
  classrooms: "operations_settings",
  classes: "classes",
  "enrollment-consultations": "enrollment",
  "student-consultations": "consultations",
  attendance: "attendance",
  invoices: "billing",
  expenses: "billing",
  textbooks: "textbooks",
  calendar: "calendar",
  shuttle: "shuttle",
};
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canManageTenant: async (_role: string, menu: string) => m.manageable.has(menu) }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ modules: { disabled: m.disabled } }) }));
vi.mock("@/features/excel-import/server/registry", () => ({ loadImporter: async (kind: string) => ({ menu: MENU_OF[kind] }) }));
vi.mock("@/components/excel-import/excel-import-button", () => ({
  ExcelImportButton: ({ kind }: { kind: string }) => <button type="button">엑셀로 넣기:{kind}</button>,
}));

// ── 과목 운영 면 쪽 모의 ──
vi.mock("@/features/owner/server/actions", () => ({ saveOwnerSection: vi.fn() }));
vi.mock("@/features/owner/server/subject-actions", () => ({
  absorbSubject: vi.fn(),
  getSubjectUsage: vi.fn(async () => ({ total: 0, items: [] })),
  removeUnusedSubject: vi.fn(),
}));
vi.mock("@/components/workspace/use-concurrent-edit-guard", () => ({
  useConcurrentEditGuard: () => ({ notifySaved: vi.fn(), rebaseline: vi.fn() }),
}));
vi.mock("@/components/workspace/use-unsaved-guard", () => ({ useUnsavedGuard: () => ({ markSaved: vi.fn() }) }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => false }));
vi.mock("@/features/owner/navigation-context", () => ({ useNavigationSettings: () => ({ tenantId: "tenant" }) }));
vi.mock("@/lib/realtime/record-channel", () => ({ publishRecordSaved: vi.fn() }));
vi.mock("@/components/forms/form-action-bar", () => ({ FormActionBar: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("./subject-session-editor", () => ({ SubjectSessionEditor: () => null }));
vi.mock("@/features/owner/operations-context", async (original) => ({
  ...(await original<typeof import("@/features/owner/operations-context")>()),
  useModuleOn: (id: string) => (id === "ecs" ? m.ecsOn : true),
}));

import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { IMPORT_KINDS, IMPORT_META } from "@/features/excel-import/kinds";
import { MONTH_PLAN_SUBJECT_KEY } from "@/features/owner/month-plan-texts";
import type { OperationsSettings } from "@/features/owner/settings-types";
import { ImportHubFace } from "./import-hub-face";
import { SubjectsSection } from "./subjects-section";

beforeEach(() => {
  m.user = { id: "u", tenantId: "t", systemRole: "master" };
  m.disabled = [];
  m.manageable = new Set(Object.values(MENU_OF));
  m.ecsOn = true;
});
afterEach(cleanup);

describe("데이터 가져오기 — 끈 기능의 줄", () => {
  const titles = () => screen.getAllByRole("listitem").map((li) => li.querySelector("p")?.textContent ?? "").filter((t) => t.includes("·"));
  const rowOf = (kind: keyof typeof IMPORT_META) => screen.queryByText((_, el) => el?.tagName === "P" && (el.textContent ?? "").startsWith(`${IMPORT_META[kind].title} ·`));

  it("전부 켜져 있으면 열두 줄이 도입 순서대로 선다", async () => {
    render(await ImportHubFace());
    expect(screen.getAllByRole("button", { name: /엑셀로 넣기/ })).toHaveLength(IMPORT_KINDS.length);
    expect(titles()).toHaveLength(IMPORT_KINDS.length);
  });

  it("🔴 끈 기능(셔틀 · 캘린더 · 교재)의 줄은 서지 않는다 — '권한이 없습니다'로도 남지 않는다", async () => {
    m.disabled = ["shuttle", "calendar", "textbooks"];
    render(await ImportHubFace());
    for (const kind of ["shuttle", "calendar", "textbooks"] as const) expect(rowOf(kind), kind).toBeNull();
    expect(rowOf("students")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: /엑셀로 넣기/ })).toHaveLength(IMPORT_KINDS.length - 3);
    expect(screen.queryByText("이 메뉴의 전체 권한이 없습니다")).toBeNull();
  });

  it("줄 번호는 보이는 줄끼리 1부터 이어진다(빈 번호가 남지 않는다)", async () => {
    m.disabled = ["shuttle", "calendar"];
    const { container } = render(await ImportHubFace());
    const numbers = [...container.querySelectorAll("ul > li > span.num")].map((el) => el.textContent);
    expect(numbers).toEqual(Array.from({ length: IMPORT_KINDS.length - 2 }, (_, i) => String(i + 1)));
  });

  it("켜져 있는데 권한만 없는 줄은 그대로 선다 — 버튼 대신 안내", async () => {
    m.manageable.delete("billing");
    render(await ImportHubFace());
    expect(rowOf("invoices")).not.toBeNull();
    expect(rowOf("expenses")).not.toBeNull();
    expect(screen.getAllByText("이 메뉴의 전체 권한이 없습니다")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "엑셀로 넣기:invoices" })).toBeNull();
  });

  it("기능에 속하지 않은 메뉴의 줄(원생 · 직원 등)은 무엇을 꺼도 선다", async () => {
    m.disabled = ["shuttle", "calendar", "textbooks", "ecs", "mcs", "kiosk"];
    render(await ImportHubFace());
    for (const kind of ["students", "staff", "classrooms", "classes", "attendance", "invoices"] as const) expect(rowOf(kind), kind).not.toBeNull();
  });
});

describe("과목 운영 — 월간 계획서 인쇄 문구", () => {
  const HEADING = "월간 계획서(MP) 인쇄 문구";
  const operations = (): OperationsSettings => structuredClone(DEFAULT_SETTINGS.operations);
  const payload = (container: HTMLElement) =>
    JSON.parse((container.querySelector('input[type="hidden"][name="data"]') as HTMLInputElement).value) as OperationsSettings;

  it("전제 — 기본 설정에 영어와 다른 과목이 함께 있고, 읽는 과목은 영어다", () => {
    expect(MONTH_PLAN_SUBJECT_KEY).toBe("english");
    const keys = operations().subjects.map((s) => s.key);
    expect(keys).toContain("english");
    expect(keys.length).toBeGreaterThan(1);
  });

  it("🔴 편집 칸은 영어 과목에만 선다 — 다른 과목에는 적어도 나오는 곳이 없다", () => {
    render(<SubjectsSection initial={operations()} sessionYear={2026} baselineToken="S0" />);
    expect(screen.getAllByText(HEADING)).toHaveLength(1);
  });

  it("영어 강사 시트 기능을 끈 학원에는 서지 않는다(읽는 화면이 없다)", () => {
    m.ecsOn = false;
    render(<SubjectsSection initial={operations()} sessionYear={2026} baselineToken="S0" />);
    expect(screen.queryByText(HEADING)).toBeNull();
  });

  it("🔴 칸을 감춘 과목에 이미 저장된 값은 지우지 않는다 — 저장할 때 그대로 실려 나간다", () => {
    const ops = operations();
    const other = ops.subjects.find((s) => s.key !== "english")!;
    other.monthPlan = { bookLegend: "남겨 둔 범례", notices: "", slogan: "", prepTitle: "", prepNotes: "" };
    const { container } = render(<SubjectsSection initial={ops} sessionYear={2026} baselineToken="S0" />);
    expect(payload(container).subjects.find((s) => s.key === other.key)?.monthPlan?.bookLegend).toBe("남겨 둔 범례");
    // 기능을 꺼서 영어의 칸이 사라져도 영어에 저장된 값은 그대로다.
    m.ecsOn = false;
    cleanup();
    const english = ops.subjects.find((s) => s.key === "english")!;
    english.monthPlan = { bookLegend: "영어 범례", notices: "", slogan: "", prepTitle: "", prepNotes: "" };
    const again = render(<SubjectsSection initial={ops} sessionYear={2026} baselineToken="S0" />);
    expect(payload(again.container).subjects.find((s) => s.key === "english")?.monthPlan?.bookLegend).toBe("영어 범례");
  });
});
