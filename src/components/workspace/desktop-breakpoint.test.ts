import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DESKTOP_MIN_WIDTH } from "./use-is-desktop";

/**
 * **데스크톱 셸 경계 한 벌** 가드 — 원장 2026-09-28 *"작아지면 그냥 모바일 뷰로 넘어가게"* · *"다른 화면도 대시보드 기준으로
 * 전체 적용"*. 사이드바↔상단 바 전환(`desk:`), 페이지 헤더 접힘(`compact-chrome`), 툴바 레일, 기간 네비, JS 판정
 * (`useIsDesktop`)이 한 값이어야 한다 — 한쪽만 바꾸면 "사이드바도 상단 바도 없는" 폭이나 "데스크톱인데 모바일 헤더"가 생긴다.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
// 🔴 '마우스'는 any-pointer(하나라도) — 주 입력만 보는 pointer는 터치스크린 PC를 모바일로 보낸다(원장 2026-10-15).
const DESKTOP = `(min-width: ${DESKTOP_MIN_WIDTH}px) and (any-pointer: fine)`;
const MOBILE = `(max-width: ${DESKTOP_MIN_WIDTH - 0.02}px), not all and (any-pointer: fine)`;
// 모바일 절 선택자의 접두 — 마우스 움직임으로 데스크톱이 된 기기는 건너뛰되, 인쇄하는 동안은 종전대로 건다(desk-detect.ts).
const PREFIX = ":where(:root:not([data-desk]), :root[data-print]) ";

describe("데스크톱 경계 = DESKTOP_MIN_WIDTH 한 값", () => {
  it("대시보드 최소 폭(1180) + 접힌 사이드바가 들어가는 값", () => {
    expect(DESKTOP_MIN_WIDTH).toBe(1240);
  });
  it("globals.css — desk 변형 · compact-chrome · 툴바 레일", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain(`@media ${DESKTOP}`);
    expect(css.split(MOBILE).length - 1).toBe(2);
    expect(css).not.toContain("1240px) and (pointer: fine)");
    expect(css).not.toContain("1239.98px), (pointer: coarse)");
    expect(css).not.toContain("1023.98px");
  });
  it("기간 네비 · 모바일 가로 줄 · 직원 행 모바일 절", () => {
    for (const f of ["src/components/period-nav.module.css", "src/components/ui/mobile-scroll-row.module.css", "src/app/(shell)/staff/staff-rows.module.css"]) {
      expect(read(f), f).toContain(MOBILE);
    }
  });
  it("JS 판정(useIsDesktop)도 같은 글자", () => {
    expect(read("src/components/workspace/use-is-desktop.ts")).toContain("(min-width: ${DESKTOP_MIN_WIDTH}px) and (any-pointer: fine)");
  });
  // 원장 2026-10-16 갤럭시북 "화면을 아무리 축소해도 대시보드가 상단임" — 브라우저가 마우스를 못 알아보는 기기는 실제 움직임으로(desk-detect.ts).
  it("🔴 두 번째 갈래(data-desk) — desk 변형·최대화는 켜고, 모바일 절 다섯 곳은 건너뛴다", () => {
    const css = read("src/app/globals.css");
    // 인쇄하는 동안(data-print)은 표시를 무시한다 — 인쇄물은 종전 미디어쿼리 판정 그대로(적대적 리뷰 2026-10-16).
    expect(css).toContain("&:where(:root[data-desk]:not([data-print]) *) {");
    expect(css).not.toContain("&:where([data-desk] *)");
    expect(css).toContain("&:where(:root:not([data-desk]) *, :root[data-print] *) {"); // compact-chrome
    expect(css).toContain("&:where(:root:not([data-mouse]) *, :root[data-print] *) {"); // no-mouse
    expect(css).toContain(":where([data-desk]) [data-page-maximize=\"on\"] [data-maximize-hide]");
    // 모바일 절 안의 선택자 줄은 전부 접두가 붙어야 한다 — 하나라도 빠지면 그 규칙만 데스크톱에 샌다.
    const blocks = (src: string, indent: string) => {
      const out: string[] = [];
      let i = src.indexOf(MOBILE);
      while (i >= 0) {
        const end = src.indexOf(`\n${indent}}`, i);
        out.push(src.slice(i, end));
        i = src.indexOf(MOBILE, end);
      }
      return out;
    };
    const rail = blocks(css, "  ").find((b) => b.includes(".toolbar-rail"))!;
    expect(rail.split("\n").filter((l) => /^\s+\.[a-z]/.test(l))).toEqual([]);
    expect(rail).not.toContain(":where(:root:not([data-desk])) ");
    expect(rail.split(PREFIX).length - 1).toBe(8);
    for (const f of ["src/components/period-nav.module.css", "src/components/ui/mobile-scroll-row.module.css", "src/app/(shell)/staff/staff-rows.module.css"]) {
      const [b] = blocks(read(f).replace(/\r\n/g, "\n"), "");
      expect(b, f).toContain(PREFIX);
      expect(b, f).not.toContain(":where(:root:not([data-desk])) ");
      expect(b!.split("\n").filter((l) => /^\s+\.[a-zA-Z]/.test(l)), f).toEqual([]);
    }
  });
  it("판정 스크립트는 루트 레이아웃 <head>에 · JS 판정도 data-desk를 본다", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain("dangerouslySetInnerHTML={{ __html: deskDetectScript() }}");
    expect(layout).toContain("suppressHydrationWarning");
    const hook = read("src/components/workspace/use-is-desktop.ts");
    expect(hook).toContain('document.documentElement.hasAttribute("data-desk")');
    expect(hook).toContain("window.addEventListener(DESK_CHANGE_EVENT, notify)");
    // 서버(루트 레이아웃)가 읽는 상수는 "use client" 밖에([[#81]])
    expect(read("src/components/workspace/desk-detect.ts")).not.toMatch(/^\s*["']use client["']/);
  });
  it("셸 두 벌(앱·슈퍼관리자)은 lg:pointer-fine이 아니라 desk:", () => {
    for (const f of ["src/app/(shell)/layout.tsx", "src/app/(super-admin)/layout.tsx"]) {
      const src = read(f);
      expect(src).not.toContain("lg:pointer-fine:");
      expect(src).toContain("desk:hidden");
      // 🔴 셸 바깥 틀의 가로 전환도 같은 경계 — `lg:flex-row`로 남기면 1024~1239에서 상단 바가 왼쪽 기둥으로 선다(리뷰 2026-09-28).
      expect(src).not.toMatch(/\blg:flex-row\b/);
      expect(src).toContain("desk:flex-row");
    }
  });
});
