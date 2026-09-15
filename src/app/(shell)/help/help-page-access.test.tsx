import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HELP_BOARD_NOT_READY } from "@/features/help/board/missing";

const ctx = vi.hoisted(() => ({
  role: "admin" as string,
  view: "admin" as "admin" | "teacher",
  allow: (() => true) as (role: string, menu: string) => boolean,
}));
const board = vi.hoisted(() => ({
  getHelpPostsPage: vi.fn(async () => ({ ready: true, rows: [], total: 0 })),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/help", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth/require-access", () => ({
  requireAccess: async () => ({ id: "u1", tenantId: "t1", systemRole: ctx.role }),
}));
vi.mock("@/lib/auth/perm-matrix", () => ({
  canAccessTenant: async (role: string, menu: string) => ctx.allow(role, menu),
}));
vi.mock("@/lib/auth/view-mode", () => ({ getShellView: async () => ctx.view }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => false }));
vi.mock("@/components/workspace/use-is-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("@/features/help/board/server/queries", () => ({
  getHelpPostsPage: board.getHelpPostsPage,
}));

import HelpPage from "./page";

const renderPage = async (q?: Record<string, string>) =>
  render(await HelpPage({ searchParams: Promise.resolve(q ?? {}) }));
const links = (name: RegExp) => screen.queryAllByRole("link", { name });

describe("도움말 — 열 수 있는 화면만 링크한다", () => {
  beforeEach(() => {
    ctx.role = "admin";
    ctx.view = "admin";
    ctx.allow = () => true;
    board.getHelpPostsPage.mockResolvedValue({ ready: true, rows: [], total: 0 });
  });
  afterEach(cleanup);

  it("🔴 사무실 역할은 권한 없는 메뉴(학원 설정)를 FAQ 링크에서 뺀다", async () => {
    ctx.allow = (_role, menu) => !["owner", "kiosk_settings", "teacher_onescreen"].includes(menu);
    await renderPage();
    expect(links(/학원 설정/)).toHaveLength(0);
    expect(links(/시간표/).length).toBeGreaterThan(0);
  });

  it("머리 글은 F1 안내와 거른 FAQ 개수다", async () => {
    ctx.allow = (_role, menu) => !["owner", "kiosk_settings", "teacher_onescreen"].includes(menu);
    await renderPage();
    expect(screen.getAllByText(/F1 = 이 화면 도움말/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/자주 묻는 질문/).length).toBeGreaterThan(0);
  });

  it("표가 없어도 Q&A 는 남고 게시판은 안내만", async () => {
    board.getHelpPostsPage.mockResolvedValueOnce({ ready: false, rows: [], total: 0 });
    await renderPage();
    expect(screen.getByText(HELP_BOARD_NOT_READY)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "자주 묻는 질문" })).toBeTruthy();
  });
});
