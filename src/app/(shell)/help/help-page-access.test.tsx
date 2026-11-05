import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HELP_BOARD_NOT_READY } from "@/features/help/board/missing";
import { writeLockedNote } from "@/lib/write-lock";

const ctx = vi.hoisted(() => ({
  role: "admin" as string,
  view: "admin" as "admin" | "teacher",
  allow: (() => true) as (role: string, menu: string) => boolean,
  write: (() => true) as (role: string, menu: string) => boolean,
}));
const board = vi.hoisted(() => ({
  getHelpPostsPage: vi.fn(async () => ({ ready: true, rows: [], total: 0 })),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/help", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/auth/require-access", () => ({
  requireAccess: async () => ({ id: "u1", tenantId: "t1", systemRole: ctx.role }),
}));
vi.mock("@/lib/auth/perm-matrix", () => ({
  canAccessTenant: async (role: string, menu: string) => ctx.allow(role, menu),
  canWriteTenant: async (role: string, menu: string) => ctx.write(role, menu),
}));
vi.mock("@/lib/auth/view-mode", () => ({ getShellView: async () => ctx.view }));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ tenantId: "t1" }) }));
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
    ctx.write = () => true;
    board.getHelpPostsPage.mockResolvedValue({ ready: true, rows: [], total: 0 });
  });
  afterEach(cleanup);

  it("🔴 사무실 역할은 권한 없는 메뉴(학원 설정)를 FAQ 링크에서 뺀다", async () => {
    ctx.allow = (_role, menu) => !["owner", "kiosk_settings", "teacher_onescreen"].includes(menu);
    await renderPage();
    expect(links(/학원 설정/)).toHaveLength(0);
    expect(links(/시간표/).length).toBeGreaterThan(0);
  });

  it("머리 글은 설명서·FAQ 개수와 F1 안내다", async () => {
    ctx.allow = (_role, menu) => !["owner", "kiosk_settings", "teacher_onescreen"].includes(menu);
    await renderPage();
    // 세 축(설명서 목록 · Q&A · F1)이 머리 한 줄에 함께 적힌다 — 하나만 적으면 나머지가 있는 줄 모른다.
    expect(screen.getAllByText(/화면 설명서 \d+개/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/자주 묻는 질문 \d+개/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/F1/).length).toBeGreaterThan(0);
  });

  it("🔴 도움말이 '읽기'면 '질문하기'를 그리지 않고 안내만 — 작성 액션과 같은 판정(canWriteTenant help, 2026-11-05)", async () => {
    ctx.write = (_role, menu) => menu !== "help";
    await renderPage();
    expect(screen.queryByRole("button", { name: "질문하기" })).toBeNull();
    expect(screen.getByText(writeLockedNote("help"))).toBeTruthy();
  });

  it("도움말 쓰기 권한이면 '질문하기'가 선다", async () => {
    await renderPage();
    expect(screen.getByRole("button", { name: "질문하기" })).toBeTruthy();
  });

  it("표가 없어도 Q&A 는 남고 게시판은 안내만", async () => {
    board.getHelpPostsPage.mockResolvedValueOnce({ ready: false, rows: [], total: 0 });
    await renderPage();
    expect(screen.getByText(HELP_BOARD_NOT_READY)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "자주 묻는 질문" })).toBeTruthy();
  });
});
