import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 제출 화면(`/v/<토큰>`)의 가용성 판정 — 지점별 저장 폴더(2026-10-04)부터 그 판정은 조회 실패를 **던진다**(다른 폴더로 폴백하지 않는다).
 * 이 화면은 그 오류를 오류 화면이 아니라 "지금은 제출을 받을 수 없습니다"로 받아야 한다. 꺼진 지점의 404는 그대로여야 한다.
 */
const m = vi.hoisted(() => ({
  resolve: vi.fn(), settings: vi.fn(), availability: vi.fn(), site: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  redirect: vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); }),
}));
vi.mock("next/navigation", () => ({ notFound: m.notFound, redirect: m.redirect }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "students" ? { name: "류태경" } : { class_name: "LT4" }, error: null }) };
      return q;
    },
  }),
}));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettingsByTenantId: m.settings }));
vi.mock("@/features/video-submit/server/availability", () => ({ videoSubmitAvailability: m.availability }));
vi.mock("@/features/video-submit/server/links", () => ({ resolveSubmitToken: m.resolve }));
vi.mock("@/features/video-submit/server/site", () => ({ siteAvailability: m.site }));
vi.mock("@/features/video-submit/server/site-homework", () => ({ isAssignedHomeworkDate: async () => false, openHomeworkDates: async () => new Map() }));
vi.mock("./video-submit-form", () => ({ VideoSubmitForm: ({ className }: { className: string }) => <p>제출 폼 · {className}</p> }));

import VideoSubmitPage from "./page";

const T = "11111111-1111-4111-8111-111111111111";
const link = { id: "L1", tenant_id: T, student_id: "s1", class_id: "c1", origin: "manual", report_id: null, report_share_hash: null, expires_at: "2099-01-01T00:00:00+09:00", revoked_at: null };
const page = () => VideoSubmitPage({ params: Promise.resolve({ token: "t".repeat(43) }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  for (const fn of [m.resolve, m.settings, m.availability, m.site, m.notFound, m.redirect]) fn.mockClear();
  m.resolve.mockResolvedValue({ state: "ok", link });
  m.settings.mockResolvedValue({ modules: { disabled: [] }, profile: { name: "인재원" } });
  m.availability.mockResolvedValue({ ok: true, drive: {}, centerId: "1" });
  m.site.mockResolvedValue({ ok: false, reason: "none" });
});
afterEach(() => vi.restoreAllMocks());

describe("제출 화면 — 가용성 조회가 던질 때", () => {
  it("정상이면 제출 폼이 선다", async () => {
    render(await page());
    expect(screen.getByText("제출 폼 · LT4")).toBeInTheDocument();
  });
  it("🔴 저장 폴더 설정 조회가 던지면 오류 화면이 아니라 '지금은 제출을 받을 수 없습니다' — 원문은 화면에 없다", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    m.availability.mockRejectedValue(new Error("영상 폴더 설정을 확인하지 못했습니다."));
    render(await page());
    expect(screen.getByText("지금은 제출을 받을 수 없습니다")).toBeInTheDocument();
    expect(screen.queryByText(/영상 폴더 설정/)).toBeNull();
    expect(screen.queryByText(/제출 폼/)).toBeNull();
    // 원인은 서버 로그에 남긴다(삼키지 않는다)
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("videoSubmit.page"));
  });
  it("지점 설정 조회가 던져도 같은 안내 — 가용성 판정까지 가지 않는다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.settings.mockRejectedValue(new Error("boom"));
    render(await page());
    expect(screen.getByText("지금은 제출을 받을 수 없습니다")).toBeInTheDocument();
    expect(m.availability).not.toHaveBeenCalled();
  });
  it("🔴 ClassNote 기능이 꺼진 지점은 그대로 없는 주소(404) — 새 try가 그 이동을 삼키지 않는다", async () => {
    m.availability.mockResolvedValue({ ok: false, reason: "module_off" });
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(m.notFound).toHaveBeenCalledTimes(1);
  });
  it("저장 폴더가 없거나 준비 전이면(던지지 않는 까닭) 예전처럼 '지금은 제출을 받을 수 없습니다'", async () => {
    for (const reason of ["no_config", "no_schema", "no_center"]) {
      m.availability.mockResolvedValue({ ok: false, reason });
      const { unmount } = render(await page());
      expect(screen.getByText("지금은 제출을 받을 수 없습니다")).toBeInTheDocument();
      unmount();
    }
    expect(m.notFound).not.toHaveBeenCalled();
  });
});
