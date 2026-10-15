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
