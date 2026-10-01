import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

/** 접수 QR 만료 배선(원장 2026-10-01) — 기간 만료만 공용 '링크 만료' 페이지로, 학원이 끈 링크는 그 자리. */
const mocks = vi.hoisted(() => ({
  tok: null as Record<string, unknown> | null,
  update: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: mocks.tok, error: null }),
      update: (v: unknown) => {
        mocks.update(v);
        return chain;
      },
    };
    return { from: () => chain };
  },
}));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettingsByTenantId: async () => {
    throw new Error("PASSED_GATE");
  },
}));

import PublicIntakePage from "./page";

const open = () => PublicIntakePage({ params: Promise.resolve({ token: "intake-secret-tok" }) });

beforeEach(() => {
  mocks.redirect.mockClear();
  mocks.update.mockClear();
});

describe("/intake 만료 → /expired?kind=intake", () => {
  it("마감일이 지난 링크 → 종류만 실어 보낸다(토큰 없음) · 조회수는 안 센다", async () => {
    mocks.tok = { id: "i1", tenant_id: "t1", is_active: true, expires_at: "2020-01-01T14:59:59.000Z", usage_count: 3 };
    await expect(open()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/expired?kind=intake");
    expect(String(mocks.redirect.mock.calls[0]![0])).not.toContain("intake-secret-tok");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("학원이 끈 링크(is_active=false)는 그 자리 화면 — 만료가 아니다", async () => {
    mocks.tok = { id: "i1", tenant_id: "t1", is_active: false, expires_at: "2020-01-01T14:59:59.000Z", usage_count: 0 };
    const html = renderToStaticMarkup((await open()) as ReactElement);
    expect(html).toContain("접수를 받을 수 없습니다");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("마감 전·마감 없음은 보내지 않는다", async () => {
    for (const expires_at of [null, "2999-12-31T14:59:59.000Z"]) {
      mocks.tok = { id: "i1", tenant_id: "t1", is_active: true, expires_at, usage_count: 0 };
      await expect(open()).rejects.toThrow("PASSED_GATE");
    }
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
