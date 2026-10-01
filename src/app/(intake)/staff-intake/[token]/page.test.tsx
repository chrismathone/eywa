import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

/** 직원 등록 QR 만료 배선(원장 2026-10-01) — 켜져 있는데 마감일이 지난 링크만 공용 '링크 만료' 페이지로. */
const mocks = vi.hoisted(() => ({
  tok: null as Record<string, unknown> | null,
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/features/staff/server/intake-token", async (orig) => ({
  ...(await orig<typeof import("@/features/staff/server/intake-token")>()),
  findIntakeTokenByToken: async () => mocks.tok,
}));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettingsByTenantId: async () => {
    throw new Error("PASSED_GATE");
  },
}));

import PublicStaffIntakePage from "./page";

const open = () => PublicStaffIntakePage({ params: Promise.resolve({ token: "staff-secret-token-0001" }) });
const tok = (over: Record<string, unknown>) => ({
  id: "d1",
  token: "staff-secret-token-0001",
  name: "직원 등록",
  role: "teacher",
  submissionCount: 0,
  createdAt: "2026-09-01T00:00:00Z",
  tenantId: "t1",
  ...over,
});

// 블록 본문 — 화살표가 mock(함수)을 돌려주면 vitest가 정리 훅으로 다시 부른다.
beforeEach(() => {
  mocks.redirect.mockClear();
});

describe("/staff-intake 만료 → /expired?kind=staff", () => {
  it("켜져 있고 마감일이 지난 링크 → 종류만 실어 보낸다(토큰 없음)", async () => {
    mocks.tok = tok({ active: true, expiresAt: "2020-01-01T00:00:00Z" });
    await expect(open()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/expired?kind=staff");
    expect(String(mocks.redirect.mock.calls[0]![0])).not.toContain("staff-secret");
  });

  it("학원이 끈 QR·없는 토큰은 그 자리 화면 — 만료가 아니다", async () => {
    // 끈 QR · 없는 토큰 · 켜져 있지만 마감일을 못 읽는 값(깨진 값은 "기간이 지났다"가 아니다)
    for (const t of [tok({ active: false, expiresAt: "2020-01-01T00:00:00Z" }), null, tok({ active: true, expiresAt: "not-a-date" })]) {
      mocks.tok = t;
      const html = renderToStaticMarkup((await open()) as ReactElement);
      expect(html).toContain("등록을 받을 수 없습니다");
    }
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("마감 전·마감 없음은 보내지 않는다", async () => {
    for (const expiresAt of [null, "2999-01-01T00:00:00Z"]) {
      mocks.tok = tok({ active: true, expiresAt });
      await expect(open()).rejects.toThrow("PASSED_GATE");
    }
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
