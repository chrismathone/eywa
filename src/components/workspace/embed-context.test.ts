import { describe, expect, it } from "vitest";
import { withEmbed } from "./embed-context";

/**
 * `withEmbed` — 앱 경로·상대 쿼리에만 embed=1을 붙인다(전수검사 리뷰 2026-09-11).
 * 호출부(PeriodNav·HrefSelect·ParamLink·EcsDatePicker·EmbedLink·EmbedAnchor·창 iframe)는 판정 없이 부른다.
 */
describe("withEmbed", () => {
  it("앱 경로 — 쿼리·해시 보존", () => {
    expect(withEmbed("/students")).toBe("/students?embed=1");
    expect(withEmbed("/attendance?month=2026-09#top")).toBe("/attendance?month=2026-09&embed=1#top");
  });

  it("상대 쿼리도 붙인다(지금 경로 그대로 쿼리만 바꾸는 링크)", () => {
    expect(withEmbed("?tab=grades")).toBe("?tab=grades&embed=1");
  });

  it("두 번 불러도 한 번만", () => {
    expect(withEmbed(withEmbed("/ecs?view=week"))).toBe("/ecs?view=week&embed=1");
  });

  it("🔴 해시만 있는 링크는 그대로 — 붙이면 `?embed=1#x`가 되어 지금 쿼리가 날아간다", () => {
    expect(withEmbed("#memo")).toBe("#memo");
  });

  it("외부·프로토콜 상대 주소·주소 아닌 값은 그대로", () => {
    expect(withEmbed("https://example.com/a")).toBe("https://example.com/a");
    expect(withEmbed("//evil.example/a")).toBe("//evil.example/a");
    expect(withEmbed("mailto:a@b.c")).toBe("mailto:a@b.c");
    // 원스크린 PeriodNav는 주소 대신 날짜 문자열을 넘긴다.
    expect(withEmbed("2026-09-10")).toBe("2026-09-10");
    expect(withEmbed("")).toBe("");
  });
});
