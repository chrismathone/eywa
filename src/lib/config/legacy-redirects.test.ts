import { describe, expect, it } from "vitest";
import { buildLegacyHostRedirects, canonicalHostOf, parseHostList } from "./legacy-redirects";

describe("legacy host redirects — 도메인 이전 뒤 옛 호스트가 같은 경로로 새 도메인을 가리킨다", () => {
  it("env가 비면 리다이렉트 0개(도메인 구매 전 = 지금과 같다)", () => {
    expect(buildLegacyHostRedirects({})).toEqual([]);
    expect(buildLegacyHostRedirects({ NEXT_PUBLIC_APP_URL: "https://eywa.kr" })).toEqual([]);
    expect(buildLegacyHostRedirects({ LEGACY_REDIRECT_HOSTS: "eywa-alpha.vercel.app" })).toEqual([]);
  });

  it("옛 호스트 하나 = 루트 + 나머지 경로 두 항목, 영구(308), 호스트 조건", () => {
    const r = buildLegacyHostRedirects({
      NEXT_PUBLIC_APP_URL: "https://eywa.kr/",
      LEGACY_REDIRECT_HOSTS: "eywa-alpha.vercel.app",
    });
    expect(r).toEqual([
      { source: "/", has: [{ type: "host", value: "eywa-alpha\\.vercel\\.app" }], destination: "https://eywa.kr/", permanent: true },
      {
        source: "/:path((?!api/).+)",
        has: [{ type: "host", value: "eywa-alpha\\.vercel\\.app" }],
        destination: "https://eywa.kr/:path",
        permanent: true,
      },
    ]);
  });

  it("🔴 /api/* 는 보내지 않는다 — 전사 웹훅·크론·워커 내부 API는 옛 호스트에서 그대로 처리", () => {
    const [, rest] = buildLegacyHostRedirects({ NEXT_PUBLIC_APP_URL: "https://eywa.kr", LEGACY_REDIRECT_HOSTS: "old.example" });
    // path-to-regexp 파라미터 정규식을 JS 정규식으로 그대로 검증한다(같은 문법).
    const re = new RegExp(`^${rest!.source.replace("/:path(", "/(").replace(/\)$/, ")")}$`);
    expect(re.test("/inventory/asset/MN-005")).toBe(true);
    expect(re.test("/r/abc?x=1".split("?")[0]!)).toBe(true);
    expect(re.test("/api/webhooks/assemblyai")).toBe(false);
    expect(re.test("/api/cron/daily-briefing")).toBe(false);
  });

  it("🔴 새 호스트 자신은 옛 호스트 목록에 있어도 건너뛴다(무한 리다이렉트 방지) · 쉼표·공백·스킴 관대", () => {
    const r = buildLegacyHostRedirects({
      NEXT_PUBLIC_APP_URL: "https://eywa.kr",
      LEGACY_REDIRECT_HOSTS: " https://eywa-alpha.vercel.app/, EYWA.KR ,,old2.example/path ",
    });
    expect(r.map((x) => x.has[0]!.value)).toEqual(["eywa-alpha\\.vercel\\.app", "eywa-alpha\\.vercel\\.app", "old2\\.example", "old2\\.example"]);
    // Next의 matchHas와 같은 방식(`^value$` 정규식)으로 — 점이 와일드카드가 아니다.
    const re = new RegExp(`^${r[0]!.has[0]!.value}$`);
    expect(re.test("eywa-alpha.vercel.app")).toBe(true);
    expect(re.test("eywa-alphaXvercelXapp")).toBe(false);
  });

  it("parseHostList / canonicalHostOf", () => {
    expect(parseHostList("A.com, https://b.com/x")).toEqual(["a.com", "b.com"]);
    expect(canonicalHostOf("https://Eywa.KR/")).toBe("eywa.kr");
    expect(canonicalHostOf("not a url")).toBeNull();
    expect(canonicalHostOf("")).toBeNull();
  });
});
