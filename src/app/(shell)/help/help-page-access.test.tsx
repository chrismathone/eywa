import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 도움말은 **열 수 없는 화면을 링크하지 않는다** — 페이지 게이트와 같은 답을 내야 한다(2026-09-11 리뷰).
 * 권한 필터 없이 목록을 넘겼더니 관리자뷰에서 '원스크린'을 누르면 원스크린 창에 운영실이 떴고(원스크린 페이지가
 * 관리자뷰를 역할 홈으로 돌려보낸다), 원장 외 사무실 역할은 '학원 설정'·'출석 키오스크'로 떠돌이 창이 생겼다.
 */

const ctx = vi.hoisted(() => ({
  role: "admin" as string,
  view: "admin" as "admin" | "teacher",
  allow: (() => true) as (role: string, menu: string) => boolean,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/help", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/auth/require-access", () => ({
  requireAccess: async () => ({ id: "u1", tenantId: "t1", systemRole: ctx.role }),
}));
vi.mock("@/lib/auth/perm-matrix", () => ({
  canAccessTenant: async (role: string, menu: string) => ctx.allow(role, menu),
}));
vi.mock("@/lib/auth/view-mode", () => ({ getShellView: async () => ctx.view }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => false }));
vi.mock("@/components/workspace/use-is-desktop", () => ({ useIsDesktop: () => true }));

import HelpPage from "./page";

const renderPage = async () => render(await HelpPage());
/** 빠른 시작과 메뉴 안내에 같은 이름의 링크가 함께 설 수 있어 전부 센다. */
const links = (name: RegExp) => screen.queryAllByRole("link", { name });

describe("도움말 — 열 수 있는 화면만 링크한다", () => {
  beforeEach(() => {
    ctx.role = "admin";
    ctx.view = "admin";
    ctx.allow = () => true;
  });
  afterEach(cleanup);

  it("🔴 사무실 역할은 권한 없는 메뉴(학원 설정·출석 키오스크)를 두 목록 모두에서 뺀다", async () => {
    ctx.allow = (_role, menu) => !["owner", "kiosk_settings", "teacher_onescreen"].includes(menu);
    await renderPage();
    expect(links(/학원 설정/)).toHaveLength(0);
    expect(links(/출석 키오스크/)).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: /학원 기본 설정하기/ })).toBeNull(); // 빠른 시작 1단계
    expect(links(/시간표/).length).toBeGreaterThan(0);
  });

  it("🔴 원스크린은 강사뷰에서만 — 권한표가 열어 줘도 관리자뷰에선 그 화면이 역할 홈으로 돌려보낸다", async () => {
    ctx.role = "master";
    await renderPage();
    expect(links(/원스크린/)).toHaveLength(0);
  });

  it("강사뷰(실 강사)엔 원스크린이 서고, 강사가 못 여는 메뉴는 안 선다", async () => {
    ctx.role = "teacher";
    ctx.view = "teacher";
    ctx.allow = (_role, menu) => !["owner", "kiosk_settings", "billing"].includes(menu);
    await renderPage();
    expect(links(/원스크린/).length).toBeGreaterThan(0);
    expect(links(/학원 설정/)).toHaveLength(0);
    expect(links(/수납관리/)).toHaveLength(0);
  });

  it("🔴 겸직 관리자의 강사뷰는 강사 행으로 한 번 더 막힌다 — 레이아웃의 강사뷰 가드와 같은 판정", async () => {
    ctx.role = "admin";
    ctx.view = "teacher";
    ctx.allow = (role, menu) => role === "admin" || !["dashboard", "owner", "billing"].includes(menu);
    await renderPage();
    expect(links(/대시보드/)).toHaveLength(0); // 관리자 역할은 열리지만 강사뷰에선 레이아웃이 돌려보낸다
    expect(links(/시간표/).length).toBeGreaterThan(0);
    expect(links(/원스크린/).length).toBeGreaterThan(0);
  });

  it("머리의 개수도 거른 목록 기준이다(안 보이는 항목까지 세지 않는다)", async () => {
    ctx.allow = (_role, menu) => !["owner", "kiosk_settings", "teacher_onescreen"].includes(menu);
    await renderPage();
    // 빠른 시작 6단계 중 학원 설정·원스크린이 빠진다. 설명서 개수는 권한으로 걸러진 목록 기준.
    expect(screen.getAllByText(/빠른 시작 4단계 · 화면 설명서 \d+개/).length).toBeGreaterThan(0);
  });
});
