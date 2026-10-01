import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

/**
 * /r 만료 배선(원장 2026-10-01) — 만료면 공용 '링크 만료' 페이지로 보내고, 취소·일시 오류는 그 자리 화면.
 * 게이트를 통과한 뒤 첫 단계(`headers()`)에서 표식 오류를 던져 "보내지 않고 본문으로 갔다"를 잰다.
 */
const mocks = vi.hoisted(() => ({
  row: { data: null as Record<string, unknown> | null, error: null as unknown },
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("next/headers", () => ({
  headers: async () => {
    throw new Error("PASSED_GATE");
  },
}));
vi.mock("@/lib/date-kst", async (orig) => ({
  ...(await orig<typeof import("@/lib/date-kst")>()),
  kstToday: () => "2026-10-01",
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => mocks.row,
    };
    return { from: () => chain };
  },
}));

import PublicLessonReportPage from "./page";

const open = () => PublicLessonReportPage({ params: Promise.resolve({ token: "tok-secret-123" }) });
const report = (over: Record<string, unknown>) => ({
  id: "r1",
  tenant_id: "t1",
  student_id: "s1",
  subject: "math",
  revoked_at: null,
  ...over,
});

beforeEach(() => {
  mocks.redirect.mockClear();
  mocks.notFound.mockClear();
  mocks.row = { data: null, error: null };
});

describe("/r 만료 → /expired?kind=report", () => {
  it("보고서일+91일(만료) → 307 대상 = 종류만, 토큰 없음", async () => {
    mocks.row = { data: report({ report_date: "2026-07-02" }), error: null }; // +90 = 09-30, 오늘 10-01
    await expect(open()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    const to = mocks.redirect.mock.calls[0]![0];
    expect(to).toBe("/expired?kind=report");
    expect(to).not.toContain("tok-secret-123");
  });

  it("🔴 90일째 당일은 유효 — 보내지 않고 본문으로", async () => {
    mocks.row = { data: report({ report_date: "2026-07-03" }), error: null }; // +90 = 10-01 = 오늘
    await expect(open()).rejects.toThrow("PASSED_GATE");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("취소된 보고서는 그 자리 취소 화면(만료여도 — 강사의 차단이 사실)", async () => {
    for (const date of ["2026-09-28", "2026-01-01"]) {
      mocks.row = { data: report({ report_date: date, revoked_at: "2026-09-29T00:00:00Z" }), error: null };
      const html = renderToStaticMarkup((await open()) as ReactElement);
      expect(html).toContain("열람이 중단된 링크입니다");
      expect(html).not.toContain("90일");
    }
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("일시 오류는 그 자리(주소의 토큰을 지켜야 새로고침으로 다시 연다)", async () => {
    mocks.row = { data: null, error: { message: "timeout" } };
    const html = renderToStaticMarkup((await open()) as ReactElement);
    expect(html).toContain("보고서를 잠시 불러올 수 없습니다");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("없는 토큰은 404 그대로(만료로 보내지 않는다)", async () => {
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
