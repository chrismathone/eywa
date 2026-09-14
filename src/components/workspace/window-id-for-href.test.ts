import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: () => {} }) }));

import { windowIdForHref } from "./window-link";
import { withEmbed } from "./embed-context";

/** 대시보드는 배경, 하위 공지·브리핑 및 업무 화면은 창으로 연다. */
describe("windowIdForHref", () => {
  it("기본 대시보드는 배경이고 하위 관리 화면은 독립 창이다", () => {
    expect(windowIdForHref("/dashboard")).toBeNull();
    expect(windowIdForHref("/dashboard?view=one")).toBeNull();
    expect(windowIdForHref("/dashboard/announcements")?.id).toBe("dashboard/announcements");
    expect(windowIdForHref("/dashboard/briefing#daily-briefing")?.id).toBe("dashboard/briefing");
  });

  it("메뉴 루트·상세·추가 창 라우트는 종전대로 창 id", () => {
    expect(windowIdForHref("/students")).toEqual({ id: "students", navLabel: expect.any(String) });
    expect(windowIdForHref("/students/abc?tab=x#top")?.id).toBe("students/abc");
    expect(windowIdForHref("/me")).toEqual({ id: "me", navLabel: "내 정보" });
    expect(windowIdForHref("https://example.com/x")).toBeNull();
  });

  it("🔴 화면 설명서는 도움말 창 하나 — 슬러그마다 창이 늘지 않는다", () => {
    expect(windowIdForHref("/help")).toEqual({ id: "help", navLabel: "도움말" });
    expect(windowIdForHref("/help/timetable")?.id).toBe("help");
    expect(windowIdForHref("/help/icons")?.id).toBe("help");
    expect(windowIdForHref("/help/students?embed=1")?.id).toBe("help");
  });

  it("🔴 알림 벨에 운영실 특례가 남아 있지 않다 — 다른 링크와 같은 경로로 창을 연다", () => {
    const bell = readFileSync(
      join(__dirname, "..", "..", "features", "notifications", "components", "notification-bell.tsx"),
      "utf8",
    );
    expect(bell).not.toContain('linkPath === "/dashboard"');
    expect(bell).toContain("windowIdForHref(link)");
  });

  it("🔴 embed 파라미터가 해시를 밀어내지 않는다 — 브리핑 알림이 창 안에서 풀 셸로 뜨던 원인", () => {
    expect(withEmbed("/dashboard#daily-briefing")).toBe("/dashboard?embed=1#daily-briefing");
    expect(withEmbed("/dashboard?x=1#top")).toBe("/dashboard?x=1&embed=1#top");
    expect(withEmbed("/students")).toBe("/students?embed=1");
  });
});
