import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ branding: vi.fn() }));
vi.mock("@/features/owner/server/public-branding", async (orig) => ({
  ...(await orig<typeof import("@/features/owner/server/public-branding")>()),
  getPublicBranding: mocks.branding,
}));

import LinkExpiredPage, { metadata } from "./page";

const render = async (kind?: string | string[]) =>
  renderToStaticMarkup(await LinkExpiredPage({ searchParams: Promise.resolve(kind === undefined ? {} : { kind }) }));

beforeEach(() => {
  mocks.branding.mockResolvedValue(null);
});

describe("공용 '링크 만료' 페이지(/expired)", () => {
  it("보고서 — 제목 + 90일 안내", async () => {
    const html = await render("report");
    expect(html).toContain("링크가 만료되었습니다");
    expect(html).toContain("보고서 링크는 보고서일로부터 90일 동안 열 수 있습니다.");
  });

  it("영상 제출 — 7일 안내", async () => {
    expect(await render("video")).toContain("영상 제출 링크는 7일 동안 쓸 수 있습니다.");
  });

  it("모르는 종류·없음 → 일반 문구(원시 값을 화면에 그대로 내보내지 않는다)", async () => {
    for (const kind of [undefined, "", "zzz-raw-kind", ["zzz-raw-kind"]]) {
      const html = await render(kind);
      expect(html).toContain("링크가 만료되었습니다");
      expect(html).toContain("사용 기간이 지나");
      expect(html).not.toContain("zzz-raw-kind");
    }
  });

  it("🔴 검색 노출 차단(noindex·nofollow)", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("🔴 학원 이름을 적지 않는다 — 어느 지점 링크인지 몰라 대표 지점 이름이 남의 지점 학부모에게 선다", async () => {
    mocks.branding.mockResolvedValue({
      tenantId: "t1",
      settings: { profile: { name: "테스트학원", logoText: "테스트", branchLabel: "본점" } },
    });
    const html = await render("report");
    expect(html).not.toContain("테스트학원");
    expect(html).not.toContain("본점");
    expect(html).not.toContain("에이와"); // 제품명으로 채우지도 않는다
    expect(mocks.branding).not.toHaveBeenCalled();
  });

  it("글자 크기는 토큰만(`text-[Npx]` 금지)", async () => {
    expect(await render("report")).not.toMatch(/text-\[\d+px\]/);
  });
});
