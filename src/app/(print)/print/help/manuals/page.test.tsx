import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MANUALS } from "@/features/help/manuals";

const mocks = vi.hoisted(() => ({ opens: vi.fn() }));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: async () => ({ systemRole: "master" }) }));
vi.mock("@/lib/auth/view-mode", () => ({ getShellView: async () => "full" }));
vi.mock("@/features/help/access", () => ({ helpLinkOpens: mocks.opens }));
vi.mock("@/lib/date-kst", () => ({ kstToday: () => "2026-10-05" }));

import ManualBundlePage from "./page";

beforeEach(() => mocks.opens.mockResolvedValue(true));

describe("전체 화면 설명서 PDF 인쇄본", () => {
  it("표지 기준일·목차·모든 허용 설명·마지막 안내를 순서대로 담는다", async () => {
    const html = renderToStaticMarkup(await ManualBundlePage());
    expect(html).toContain("자료 기준일");
    expect(html).toContain("2026-10-05");
    expect(html.indexOf("전체 화면 설명서")).toBeLessThan(html.indexOf("목차"));
    expect(html.indexOf("목차")).toBeLessThan(html.indexOf(`id="manual-${MANUALS[0].slug}"`));
    for (const manual of MANUALS) expect(html).toContain(`id="manual-${manual.slug}"`);
    expect(html.indexOf(`id="manual-${MANUALS.at(-1)!.slug}"`)).toBeLessThan(html.indexOf("END OF GUIDE"));
  });

  it("권한이 없는 설명서는 목차와 본문 양쪽에서 빠진다", async () => {
    mocks.opens.mockImplementation(async (menuKey: string | null) => menuKey !== "mcs");
    const html = renderToStaticMarkup(await ManualBundlePage());
    expect(html).not.toContain('id="manual-mcs"');
    expect(html).not.toContain('href="#manual-mcs"');
    expect(html).toContain('id="manual-dashboard"');
  });
});
