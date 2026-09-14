import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { goalFillColor } from "./goal-rail-bar";

// 원장 2026-09-14 "목표진도만 채워질수록 진한 빨간색. 현재진도는 지금 그대로"
//   → 같은 날 "목표 진도 붉은색이 지금 자홍색 느낌인데 더 붉게"
describe("목표진도 채움 색 — 채울수록 진한 빨강", () => {
  it("채움 비율이 진한 끝(--goal-fill-strong)의 섞는 비율이 된다", () => {
    expect(goalFillColor(0)).toContain("var(--goal-fill-strong) 0%");
    expect(goalFillColor(58)).toContain("var(--goal-fill-strong) 58%");
    expect(goalFillColor(100)).toContain("var(--goal-fill-strong) 100%");
  });

  it("옅은 끝은 이 막대 전용 토큰 — srgb로 섞고, 흰 바탕·출석부 토큰·새 색 값을 섞지 않는다", () => {
    const c = goalFillColor(40);
    expect(c).toContain("var(--goal-fill-soft)");
    expect(c).toContain("in srgb");
    // 탁한 분홍으로 읽히던 옛 조합(흰 바탕에 옅게)과 출석부 팔레트 빌려 쓰기로 되돌아가지 않게.
    expect(c).not.toContain("var(--card)");
    expect(c).not.toContain("--att-");
    expect(c).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("범위 밖·비정상 값은 0~100으로 자른다", () => {
    expect(goalFillColor(-20)).toContain("var(--goal-fill-strong) 0%");
    expect(goalFillColor(140)).toContain("var(--goal-fill-strong) 100%");
    expect(goalFillColor(Number.NaN)).toContain("var(--goal-fill-strong) 0%");
    expect(goalFillColor(33.6)).toContain("var(--goal-fill-strong) 34%");
  });

  /**
   * 🔴 문자열 모양이 아니라 **성질**을 잠근다 — 누가 두 토큰의 명도를 뒤집으면(옅은 끝을 더 어둡게) 위 테스트는
   *    초록인 채로 막대가 거꾸로 옅어진다. 값은 globals.css에서 읽는다(palette-contrast 가드와 같은 방식).
   */
  it("옅은 끝이 진한 끝보다 밝고, 농도 차가 눈에 띄게 남는다", () => {
    const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const hexOf = (token: string) => {
      const m = new RegExp(`--${token}:\\s*#([0-9a-fA-F]{6})`).exec(css);
      expect(m, `globals.css에 --${token} 없음`).not.toBeNull();
      return m![1];
    };
    // 상대 휘도(WCAG) — 두 끝의 밝기 순서와 간격만 본다.
    const lum = (hex: string) => {
      const ch = [0, 2, 4].map((i) => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
    };
    const soft = lum(hexOf("goal-fill-soft"));
    const strong = lum(hexOf("goal-fill-strong"));
    expect(soft).toBeGreaterThan(strong);
    // 양 끝 대비비 — 농도로 읽는 막대라 너무 붙으면 뜻을 잃는다(지금 5.0:1 · 반려된 램프가 2.55였다).
    expect((soft + 0.05) / (strong + 0.05)).toBeGreaterThan(3);
  });
});
