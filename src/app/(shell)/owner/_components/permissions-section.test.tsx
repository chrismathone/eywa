/**
 * 학원설정 '강사 내 메뉴 표시' 토글이 **실제로 메뉴를 바꾸는 탭만** 보여 준다 (2026-09-11 리뷰).
 *
 * 캘린더를 메뉴에서 뺀 뒤(원장 2026-09-10) 강사 '내 메뉴'는 입구 정책으로 캘린더를 거르는데, 이 토글 목록은
 * `TEACHER_MENU_KEYS`를 그대로 돌아서 캘린더 체크박스가 남아 있었다 — 켜도 꺼도 메뉴엔 아무 일도 없는
 * 거짓 약속(write-only-orphan과 같은 모양). 입구 정책은 NAV 표의 순수 함수 하나이고 두 소비처가 같이 쓴다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { teacherMenuKeysFor } from "@/lib/navigation";
import { MENU_LABEL, resolveMatrix, TEACHER_MENU_KEYS } from "@/lib/permissions";
import { PermissionsSection } from "./permissions-section";

vi.mock("./section-form", () => ({
  SectionForm: ({ children, payload }: { children?: ReactNode; payload?: unknown }) => <form>{children}<output data-testid="payload">{JSON.stringify(payload)}</output></form>,
}));
vi.mock("@/components/ui/drag-scroll-area", () => ({
  DragScrollArea: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const EMPTY = { overrides: [], userOverrides: [], specialAccess: { payslipViewerIds: [], leaveAdjusterIds: [] } };

/** '강사 내 메뉴 표시' 구획의 체크박스 라벨(" · 고정" 꼬리는 뗀다). */
function toggleLabels(): string[] {
  render(<PermissionsSection initial={EMPTY} />);
  const section = screen.getByRole("heading", { name: /내 메뉴.*표시/ }).closest("section") as HTMLElement;
  return within(section)
    .getAllByRole("checkbox")
    .map((c) => (c.closest("label")?.textContent ?? "").replace(" · 고정", "").trim());
}

describe("학원설정 '강사 내 메뉴 표시' — 메뉴에서 뺀 탭은 토글 목록에 없다", () => {
  it("🔴 캘린더(원장 2026-09-10 메뉴에서 제외)는 빠진다 — 켜도 꺼도 메뉴엔 아무 일도 없는 칸이다", () => {
    expect(toggleLabels()).not.toContain(MENU_LABEL.calendar);
  });

  it("사이드바엔 숨겼지만 강사 드롭다운이 유일한 입구인 교재 요청·지출결의서는 남는다", () => {
    const labels = toggleLabels();
    expect(labels).toContain(MENU_LABEL.textbook_requests);
    expect(labels).toContain(MENU_LABEL.expense_requests);
  });

  it("🔑 토글 목록 = 강사 '내 메뉴'가 세울 수 있는 탭 — 두 소비처가 같은 입구 정책을 쓴다", () => {
    // 강사에게 전부 연 매트릭스면 '내 메뉴'가 세우는 탭 = 입구가 열린 탭 전부다(순서도 같다).
    const open = resolveMatrix(
      TEACHER_MENU_KEYS.map((menu) => ({ menu, role: "teacher" as const, access: "full" as const })),
    );
    expect(toggleLabels()).toEqual(teacherMenuKeysFor("teacher", open).map((k) => MENU_LABEL[k]));
  });

  it("캘린더의 페이지 접근은 아래 '역할별 메뉴 권한' 표에서 그대로 조정된다", () => {
    render(<PermissionsSection initial={EMPTY} />);
    expect(within(screen.getByRole("table")).getByText(MENU_LABEL.calendar)).toBeInTheDocument();
  });
});

describe("배선 — 입구 정책은 navigation.ts의 순수 함수 하나", () => {
  const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

  it("강사 '내 메뉴'(teacherMenuKeysFor)와 이 토글이 같은 함수(isTeacherMenuEntranceOpen)를 쓴다", () => {
    const nav = read("src", "lib", "navigation.ts");
    expect(nav).toMatch(/export function isTeacherMenuEntranceOpen\(/);
    const from = nav.indexOf("export function teacherMenuKeysFor(");
    expect(from).toBeGreaterThan(-1);
    expect(nav.slice(from, nav.indexOf("\n}", from))).toContain("isTeacherMenuEntranceOpen(");
    expect(read("src", "app", "(shell)", "owner", "_components", "permissions-section.tsx")).toContain(
      "TEACHER_MENU_KEYS.filter(isTeacherMenuEntranceOpen)",
    );
  });
});

describe("일반판 권한 설정", () => {
  const staff = [{ id: "11111111-1111-4111-8111-111111111111", name: "데모 강사", role: "teacher" }];
  const payload = () => JSON.parse(screen.getByTestId("payload").textContent ?? "{}");

  it("직원 한 명에게 메뉴 예외를 추가하고 해제할 수 있다", () => {
    render(<PermissionsSection initial={EMPTY} generic staffOptions={staff} />);
    fireEvent.change(screen.getByLabelText("직원 선택"), { target: { value: staff[0].id } });
    fireEvent.change(screen.getByLabelText("메뉴 선택"), { target: { value: "staff" } });
    fireEvent.click(screen.getByRole("button", { name: "추가·변경" }));
    expect(payload().userOverrides).toEqual([{ userId: staff[0].id, menu: "staff", access: "full" }]);
    fireEvent.click(screen.getByRole("button", { name: "제거" }));
    expect(payload().userOverrides).toEqual([]);
  });

  it("급여명세서 열람과 연차 조정을 별도 명단으로 저장한다", () => {
    render(<PermissionsSection initial={EMPTY} generic staffOptions={staff} />);
    fireEvent.change(screen.getByLabelText("급여명세서 열람 담당자 선택"), { target: { value: staff[0].id } });
    fireEvent.click(screen.getAllByRole("button", { name: "담당자 추가" })[0]);
    expect(payload().specialAccess.payslipViewerIds).toEqual([staff[0].id]);
    expect(payload().specialAccess.leaveAdjusterIds).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "데모 강사 급여명세서 열람 해제" }));
    expect(payload().specialAccess.payslipViewerIds).toEqual([]);
  });

  it("침산 화면에는 일반판 담당자 편집기가 나타나지 않는다", () => {
    render(<PermissionsSection initial={EMPTY} staffOptions={staff} />);
    expect(screen.queryByText("민감 기능 담당자")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("직원 선택")).not.toBeInTheDocument();
  });

  it("운영자 계정은 선택·기존 예외·담당자에서 숨기고 지점 저장은 숨겨진 값을 보존한다", () => {
    const operator = { id: "22222222-2222-4222-8222-222222222222", name: "운영 계정", role: "master" };
    const hiddenOverride = { userId: operator.id, menu: "staff" as const, access: "full" as const };
    render(<PermissionsSection initial={{ ...EMPTY, userOverrides: [hiddenOverride], specialAccess: { payslipViewerIds: [operator.id], leaveAdjusterIds: [operator.id] } }}
      generic staffOptions={[...staff, operator]} hiddenUserIds={[operator.id]} />);
    expect(screen.queryByText(operator.name)).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: operator.name })).not.toBeInTheDocument();
    expect(screen.getByText("개인별 메뉴 권한 0건")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("직원 선택"), { target: { value: staff[0].id } });
    fireEvent.click(screen.getByRole("button", { name: "추가·변경" }));
    expect(payload().userOverrides).toContainEqual(hiddenOverride);
    expect(payload().userOverrides).toContainEqual({ userId: staff[0].id, menu: "staff", access: "full" });
    expect(payload().specialAccess).toEqual({ payslipViewerIds: [operator.id], leaveAdjusterIds: [operator.id] });
  });
});
