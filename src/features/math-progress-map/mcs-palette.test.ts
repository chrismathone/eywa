import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * MCS 색 규칙은 하나다 — **실제 진도(현재·도달·완료) = 파랑 · 목표 = 빨강**(globals.css `--mcs-*`).
 *
 * 원장 2026-09-19: *"우상단 라벨 색상과 실제 시계에서 라벨 색상이 달라서 착각을 줄 수 있을 것 같네"* →
 * *"mcs 막대와 완전히 일치하는 규칙으로. mcs 막대 규칙도 하나로 통일"*. 그 전엔 막대는 완료를 파랑,
 * 월별 타임라인·차시 점은 빨강, 시계는 네이비·연녹색·갈색, 범례는 또 다른 색이었다.
 */
const ROOT = process.cwd();
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const MCS_CSS = [
  "src/features/math-sheets/components/learning-rails.module.css",
  "src/features/math-sheets/components/learning-overview.module.css",
  "src/features/math-progress-map/components/linked-learning-map.module.css",
  "src/features/math-progress-map/components/timeline/timeline.module.css",
  "src/features/math-progress-map/components/progress-map.module.css",
];

/** 선택자 목록(쉼표로 묶인 것 포함)이 정확히 이 선택자를 담는 규칙 본문들. */
function ruleBodies(css: string, selector: string): string[] {
  const out: string[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(",").map((s) => s.trim());
    if (selectors.includes(selector)) out.push(m[2]!);
  }
  return out;
}
function declared(body: string, prop: string): string | null {
  return new RegExp(`${prop}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? null;
}

describe("MCS 색 규칙 — 실제 진도 파랑 · 목표 빨강 한 벌", () => {
  it("두 색의 값은 globals.css 한 곳에 있다", () => {
    const css = read("src/app/globals.css");
    expect(css).toMatch(/--mcs-actual:\s*#0000ff;/i);
    expect(css).toMatch(/--mcs-actual-soft:\s*#[0-9a-f]{6};/i);
    expect(css).toMatch(/--mcs-goal:\s*#ff0000;/i);
  });

  it("MCS 화면의 CSS는 파랑·빨강 값을 직접 적지 않는다(토큰만 읽는다)", () => {
    for (const file of MCS_CSS) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, file).not.toMatch(/#(?:0000ff|00f|ff0000|f00)\b/i);
    }
  });

  it("진도 시계와 범례가 같은 값을 읽는다 — 범례(.surface)와 시계(.original) 두 선택자에 같은 블록", () => {
    const css = read("src/features/math-progress-map/components/progress-map.module.css");
    const outer = ruleBodies(css, '.surface[data-learning="true"]');
    const inner = ruleBodies(css, '.surface[data-learning="true"] .original');
    const block = outer.find((body) => inner.includes(body));
    expect(block, "범례와 시계가 한 규칙 블록을 공유해야 한다").toBeDefined();
    for (const prop of ["--map-completed-fill", "--map-completed-tick", "--map-week-completed-fill", "--map-actual"]) {
      expect(declared(block!, prop), prop).toBe("var(--mcs-actual)");
    }
    for (const prop of ["--map-progress-fill", "--map-in-progress-tick"]) {
      expect(declared(block!, prop), prop).toBe("var(--mcs-actual-soft)");
    }
  });

  it("월별 타임라인은 완료를 실제 진도색으로 칠한다(목표색 금지)", () => {
    const css = read("src/features/math-progress-map/components/timeline/timeline.module.css");
    const card = ruleBodies(css, '.timelineCard[data-learning="true"]')[0]!;
    expect(declared(card, "--timeline-green")).toBe("var(--mcs-actual)");
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (m[1]!.includes('data-learning="true"') && m[1]!.includes("completed")) expect(m[2], m[1]).not.toContain("--mcs-goal");
    }
  });

  it("차시 목록의 도달 점은 실제 진도색이다", () => {
    const css = read("src/features/math-progress-map/components/linked-learning-map.module.css");
    expect(declared(ruleBodies(css, ".root")[0]!, "--current")).toBe("var(--mcs-actual)");
    expect(ruleBodies(css, '.lessonDot[data-reached="true"]')[0]).toContain("var(--current)");
  });
});
