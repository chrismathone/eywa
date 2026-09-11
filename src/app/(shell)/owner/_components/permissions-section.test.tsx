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
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { teacherMenuKeysFor } from "@/lib/navigation";
import { MENU_LABEL, resolveMatrix, TEACHER_MENU_KEYS } from "@/lib/permissions";
import { PermissionsSection } from "./permissions-section";

vi.mock("./section-form", () => ({
  SectionForm: ({ children }: { children?: ReactNode }) => <form>{children}</form>,
}));
vi.mock("@/components/ui/drag-scroll-area", () => ({
  DragScrollArea: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const EMPTY = { overrides: [], userOverrides: [] };

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
