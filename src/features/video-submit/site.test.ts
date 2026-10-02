/** 숙제 영상 올리기 사이트(0330a) — 순수 규칙 + 공개 경로·배선 가드. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isLast4, phoneEndsWith, siteLinkExpiresAt, siteLinkLastDay } from "./site";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

describe("뒷 4자리", () => {
  it("숫자 넷만", () => {
    expect(isLast4("0123")).toBe(true);
    for (const bad of ["123", "12345", "12a4", " 1234", 1234, null, undefined]) expect(isLast4(bad)).toBe(false);
  });
  it("전화번호는 숫자만 남겨 끝자리를 본다 — 하이픈·공백·괄호 무시 · 너무 짧은 번호는 아니다", () => {
    expect(phoneEndsWith("010-1234-5678", "5678")).toBe(true);
    expect(phoneEndsWith("010 1234 5678 ", "5678")).toBe(true);
    expect(phoneEndsWith("(053)123-5678", "5678")).toBe(true);
    expect(phoneEndsWith("010-1234-5679", "5678")).toBe(false);
    expect(phoneEndsWith("5678", "5678")).toBe(false);
    expect(phoneEndsWith(null, "5678")).toBe(false);
  });
});

describe("사이트가 만든 링크의 수명 — 만든 날과 다음 날", () => {
  it("끝나는 순간은 이틀 뒤 0시(KST) · 마지막으로 쓸 수 있는 날은 다음 날", () => {
    expect(siteLinkExpiresAt("2026-10-02")).toBe("2026-10-04T00:00:00+09:00");
    expect(siteLinkLastDay("2026-10-02")).toBe("2026-10-03");
    expect(siteLinkExpiresAt("2026-12-31")).toBe("2027-01-02T00:00:00+09:00");
  });
});

describe("배선 가드", () => {
  it("`/v`(올리기 사이트)는 비로그인 통과 경로다 — 막히면 학생이 로그인 화면으로 간다", () => {
    expect(read("src", "lib", "supabase", "proxy.ts")).toContain('pathname === "/v" || pathname.startsWith("/v/")');
  });
  it("화면은 학생 정보를 직접 읽지 않는다 — 조회는 횟수 제한이 걸린 라우트만", () => {
    const page = read("src", "app", "(share)", "v", "page.tsx");
    expect(page).not.toMatch(/from\("students"\)|findCandidates|lookupSite/);
    const route = read("src", "app", "api", "video-submit", "site", "route.ts");
    expect(route).toContain("lookupSite(");
    expect(route).toContain("openSiteLink(");
  });
  it("🔴 조회·열기는 횟수 판정을 지난 뒤에만 후보를 찾는다", () => {
    const code = read("src", "features", "video-submit", "server", "site.ts");
    for (const fn of ["export async function lookupSite", "export async function openSiteLink"]) {
      const body = code.slice(code.indexOf(fn));
      expect(body.indexOf("await admit(")).toBeGreaterThan(0);
      expect(body.indexOf("await admit(")).toBeLessThan(body.indexOf("findCandidates("));
    }
  });
  it("학생 상세의 사이트 주소 안내는 그 지점이 사이트를 쓸 수 있을 때만", () => {
    const code = read("src", "app", "(shell)", "students", "[id]", "_tabs", "homework-video-links.tsx");
    expect(code).toContain("site?.ok && site.tenantId === user.tenantId");
    expect(code).toContain("{siteUrl ? (");
  });
});
