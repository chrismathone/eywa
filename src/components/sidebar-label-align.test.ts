import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 사이드바 두 종류의 줄이 **같은 x에서 글자를 시작한다**.
 *
 * 원장 2026-09-10: *"탭 글씨 줄맞춤 안되어있네. 이런 기본적인것"*. 업무군 줄은 라벨 왼쪽 여백이 42px,
 * 바로 여는 줄(운영실·회의록·자주 방문한 메뉴)은 `pl-[17px]` + 아이콘 18 + `gap-2.5`(10) = **45px**라
 * 3px 어긋나 있었다. 한 줄만 있을 땐 안 보이다가 회의록이 업무군 줄 **사이에** 서면서 드러났다.
 */
describe("사이드바 라벨 줄맞춤", () => {
  const src = readFileSync(join(process.cwd(), "src/components/app-sidebar.tsx"), "utf8");

  it("업무군 줄의 라벨 시작점은 상수 하나에서 온다", () => {
    expect(src).toContain('const RAIL_LABEL_ML = "ml-[45px]"');
    expect(src).toContain("${RAIL_LABEL_ML}");
  });

  it("🔴 옛 값이 className으로 되살아나지 않는다", () => {
    expect(src).not.toContain("ml-[42px]");
  });

  it("바로 여는 줄의 산술이 45px 그대로다 — 17 + 아이콘 18 + gap 10", () => {
    // 이 셋 중 하나만 바뀌어도 두 줄이 다시 어긋난다.
    expect(src).toContain("gap-2.5 pl-[17px]");
    expect(src).toContain("left-[26px]"); // 아이콘 중심 26 → 17~35, 두 줄 공통
  });
});
