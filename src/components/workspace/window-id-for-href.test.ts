import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: () => {} }) }));

import { windowIdForHref } from "./window-link";
import { withEmbed } from "./embed-context";

/**
 * `windowIdForHref` = "이 href를 어느 창으로 여나" — 사이드바 밖 링크(WindowLink·알림 벨)가 전부 이걸 지난다.
 * 🔴 2026-09-07부터 **대시보드도 창이다**(원장 지시로 2026-09-03 결정을 뒤집었다). 그때 창을 막았던 이유 둘은
 *    함께 해소했다: 스토어의 '옛 dashboard 창 제거' 정리를 걷어냈고, `withEmbed`가 **해시를 분리**해
 *    `…?embed=1#x`로 붙인다(옛 구현은 `…#x?embed=1`이라 창 안에 풀 셸이 떴다).
 */
describe("windowIdForHref", () => {
  it("대시보드도 창 id를 돌려준다 — 해시·쿼리가 붙어도 같은 창", () => {
    expect(windowIdForHref("/dashboard")).toEqual({ id: "dashboard", navLabel: "대시보드" });
    expect(windowIdForHref("/dashboard#daily-briefing")?.id).toBe("dashboard");
    expect(windowIdForHref("/dashboard?x=1#assistant")?.id).toBe("dashboard");
  });

  it("메뉴 루트·상세·추가 창 라우트는 종전대로 창 id", () => {
    expect(windowIdForHref("/students")).toEqual({ id: "students", navLabel: expect.any(String) });
    expect(windowIdForHref("/students/abc?tab=x#top")?.id).toBe("students/abc");
    expect(windowIdForHref("/me")).toEqual({ id: "me", navLabel: "내 정보" });
    expect(windowIdForHref("https://example.com/x")).toBeNull();
  });

  it("🔴 알림 벨에 운영실 특례가 남아 있지 않다 — 다른 링크와 같은 경로로 창을 연다", () => {
    const bell = readFileSync(
      join(__dirname, "..", "..", "features", "notifications", "components", "notification-bell.tsx"),
      "utf8",
    );
    expect(bell).not.toContain('linkPath === "/dashboard"');
    expect(bell).toContain("windowIdForHref(n.link)");
  });

  it("🔴 embed 파라미터가 해시를 밀어내지 않는다 — 브리핑 알림이 창 안에서 풀 셸로 뜨던 원인", () => {
    expect(withEmbed("/dashboard#daily-briefing")).toBe("/dashboard?embed=1#daily-briefing");
    expect(withEmbed("/dashboard?x=1#top")).toBe("/dashboard?x=1&embed=1#top");
    expect(withEmbed("/students")).toBe("/students?embed=1");
  });
});
