import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: () => {} }) }));

import { windowIdForHref } from "./window-link";

/**
 * `windowIdForHref` = "이 href를 어느 창으로 여나" — 사이드바 밖 링크(WindowLink·알림 벨)가 전부 이걸 지난다.
 * 🔴 운영실(`/dashboard`, presentation:"desktop")은 **창이 아니다** — 창으로 열면 스토어가 레거시로 지우고, 해시가 붙은
 *    링크는 `withEmbed`가 `?`로만 쪼개 `…#x?embed=1`이 되어 창 안에 풀 셸이 뜬다(적대적 리뷰 2026-09-03: 브리핑 알림 착지).
 */
describe("windowIdForHref", () => {
  it("운영실(데스크톱 작업면)은 해시·쿼리가 붙어도 창 id를 돌려주지 않는다", () => {
    expect(windowIdForHref("/dashboard")).toBeNull();
    expect(windowIdForHref("/dashboard#daily-briefing")).toBeNull();
    expect(windowIdForHref("/dashboard?x=1#assistant")).toBeNull();
  });

  it("메뉴 루트·상세·추가 창 라우트는 종전대로 창 id", () => {
    expect(windowIdForHref("/students")).toEqual({ id: "students", navLabel: expect.any(String) });
    expect(windowIdForHref("/students/abc?tab=x#top")?.id).toBe("students/abc");
    expect(windowIdForHref("/me")).toEqual({ id: "me", navLabel: "내 정보" });
    expect(windowIdForHref("https://example.com/x")).toBeNull();
  });

  it("알림 벨은 운영실 링크를 창으로 열지 않고 배경 main을 보낸다(showDesktop + 해시)", () => {
    const bell = readFileSync(
      join(__dirname, "..", "..", "features", "notifications", "components", "notification-bell.tsx"),
      "utf8",
    );
    expect(bell).toContain('linkPath === "/dashboard"');
    expect(bell).toContain("showDesktop()");
    expect(bell).toContain("window.location.assign(hash)");
  });
});
