import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SHEET_MIN_WIDTH } from "./sheet-min-width";

/**
 * 구조 가드 — **폭 안내 게이트**가 조용히 거짓말하거나 막다른 길이 되지 않게 잠근다
 * (원장 2026-09-01 *"폭을 너무 좁힐 경우 일정 폭 이상 크게하라고 안내하는 화면으로"*).
 *
 * 잠그는 것 넷:
 *  ① 화면에 적는 숫자(`SHEET_MIN_WIDTH`)와 **실제 경계**(globals.css)가 같다 — 갈리면 "최소 480px"이라
 *    적어 놓고 500px에서 안내가 뜨는, 사람을 헷갈리게 하는 안내가 된다.
 *  ② 경계에 **`pointer: fine`**이 붙어 있다 — 창을 못 넓히는 폰·터치에 "넓히세요"를 띄우면 그건 안내가
 *    아니라 차단이다(ECS는 영어 전담 강사의 **홈**이다).
 *  ③ 판정은 **CSS**다 — 폭을 JS로 재면 하이드레이션이 갈리고([[#75]]·[[#108]]) 시트가 언마운트돼
 *    저장 안 된 입력이 날아간다.
 *  ④ 안내에 **나가는 문**이 있다 — 랜딩(`/ecs`)은 좁은 폭을 위해 1단 상하로 설계된 화면이라
 *    여기서 갈 수 있는 유일한 성한 곳이다.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

/**
 * `.sheet-width-gate`를 숨기는 그 @media 한 줄만 뽑는다(다른 미디어쿼리에 속지 않게).
 * ⚠️ 선택자를 **여는 중괄호까지** 찾는다 — 이름만 찾으면 위쪽 **주석**에 적힌 같은 이름을 집어
 *    엉뚱한 @media(print)를 읽는다(첫 구현이 그랬다).
 */
function gateMediaCondition(css: string): string {
  const rule = css.search(/\.sheet-width-gate\s*\{/);
  expect(rule, "globals.css에 .sheet-width-gate 규칙이 있어야 한다").toBeGreaterThan(-1);
  const before = css.slice(0, rule);
  const media = [...before.matchAll(/@media([^{]*)\{/g)].at(-1);
  expect(media, ".sheet-width-gate 는 @media 안에 있어야 한다").toBeTruthy();
  return media![1].trim();
}

describe("ECS 시트 · 폭 안내 게이트", () => {
  const css = read("app/globals.css");
  const condition = gateMediaCondition(css);

  it("① 화면에 적는 최소 폭과 실제 경계가 같은 값이다", () => {
    const m = condition.match(/max-width:\s*([\d.]+)px/);
    expect(m, `조건에 max-width 가 있어야 한다 — 실제: ${condition}`).toBeTruthy();
    // 경계는 "이 값 미만"이라 480px 자체는 통과해야 한다 → 479.98px.
    expect(Number(m![1])).toBeCloseTo(SHEET_MIN_WIDTH - 0.02, 2);
  });

  it("🔴 ② 넓힐 수 있는 기기에만 뜬다(pointer: fine) — 폰에 띄우면 안내가 아니라 차단이다", () => {
    expect(condition).toContain("pointer: fine");
  });

  it("② 인쇄에는 안 걸린다(@media screen 한정)", () => {
    expect(condition).toContain("screen");
  });

  it("🔴 ③ 폭을 JS로 재지 않는다 — 시트는 숨겨질 뿐 언마운트되지 않는다", () => {
    const gate = read("features/class-sheets/components/sheet-width-gate.tsx");
    for (const forbidden of ["useState", "useEffect", "matchMedia", "innerWidth", "use client"]) {
      expect(gate).not.toContain(forbidden);
    }
    // 마커 한 쌍이 그대로 있어야 CSS가 물린다.
    expect(gate).toContain("sheet-width-gate");
    expect(gate).toContain("sheet-too-narrow");
  });

  it("🔴 ④ 안내가 막다른 길이 아니다 — 반 목록으로 나가는 문", () => {
    const gate = read("features/class-sheets/components/sheet-width-gate.tsx");
    expect(gate).toContain('href="/ecs"');
  });

  it("주간·월간이 같은 게이트를 쓴다(화면마다 따로 만들지 않는다)", () => {
    for (const rel of ["app/(shell)/ecs/[classId]/page.tsx", "app/(shell)/ecs/[classId]/month/page.tsx"]) {
      const page = read(rel);
      expect(page).toContain("<SheetWidthGate>");
      // 손으로 만든 폭 분기를 페이지에 심으면 두 화면이 다른 폭에서 갈린다.
      expect(page).not.toContain("sheet-too-narrow");
    }
  });
});
