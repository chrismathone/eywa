import { describe, expect, it } from "vitest";
import {
  chipProps,
  chipSurfaceOf,
  colorLabel,
  dotProps,
  isCustomColor,
  normalizeCalendarColor,
} from "./color";
import { compositeOver, contrastRatio, darkenHexForContrast } from "@/lib/color-utils";

/**
 * 캘린더 색 단일 소스 — 사용자가 색상환에서 아무 색이나 고를 수 있게 되면서(원장 2026-08-19)
 * "저장은 됐는데 화면에서 안 보이는 색"과 "흰 배경에 노란 글자"가 실제 위험이 됐다.
 * 그 둘을 여기서 잠근다.
 */

describe("normalizeCalendarColor", () => {
  it("프리셋 키는 그대로 둔다", () => {
    expect(normalizeCalendarColor("blue")).toBe("blue");
    expect(normalizeCalendarColor("neutral")).toBe("neutral");
  });

  it("hex는 소문자 6자리로 정규화한다(#RGB 확장 포함)", () => {
    expect(normalizeCalendarColor("#AABBCC")).toBe("#aabbcc");
    expect(normalizeCalendarColor(" #0f0 ")).toBe("#00ff00");
  });

  it("빈 값·엉뚱한 값은 primary로 접는다(저장된 쓰레기가 화면을 깨지 않게)", () => {
    expect(normalizeCalendarColor("")).toBe("primary");
    expect(normalizeCalendarColor(null)).toBe("primary");
    expect(normalizeCalendarColor("red; drop table")).toBe("primary");
    expect(normalizeCalendarColor("#12345")).toBe("primary"); // 자릿수 미달
  });
});

describe("dotProps / chipProps", () => {
  it("프리셋은 클래스로만 그린다(inline style 없음 — 토큰이 테마를 따라간다)", () => {
    expect(dotProps("green")).toEqual({ className: "bg-green" });
    expect(chipProps("green").className).toBe("bg-green-soft text-green");
    expect(chipProps("green").style).toBeUndefined();
  });

  it("사용자 hex는 클래스가 아니라 style로 그린다(동적 클래스는 purge에 안 잡힌다)", () => {
    const dot = dotProps("#7c3aed");
    expect(dot.className).toBe("");
    expect(dot.style?.backgroundColor).toBe("#7c3aed");

    const chip = chipProps("#7c3aed");
    expect(chip.className).toBe("");
    expect(String(chip.style?.backgroundColor)).toMatch(/^rgba\(/); // 옅은 틴트
  });

  /**
   * 🔴 판정은 **대비비**로 한다 — 구현이 쓰는 공식으로 다시 재면 순환이라 통과가 보장될 뿐이다
   * (2026-08-19 적대 리뷰: 체감 밝기 기준으로 짰다가 순수 초록이 실제 2.5:1인데 통과했었다).
   */
  it.each([
    "#ffff00", // 노랑
    "#00ff00", // 초록
    "#ff0000", // 빨강
    "#ff00ff", // 마젠타
    "#00ffff", // 청록
    "#22c55e", // 흔한 팔레트 초록
    "#14b8a6", // 청록 계열
    "#ffffff", // 흰색(최악)
    "#4a7ab8", // 색상환 기본 시작색
  ])("사용자가 %s를 골라도 칩 글자가 WCAG 본문 대비(4.5:1)를 넘는다", (hex) => {
    const chip = chipProps(hex);
    const ink = String(chip.style?.color);
    expect(ink).toMatch(/^#[0-9a-f]{6}$/);
    const ratio = contrastRatio(ink, chipSurfaceOf(hex));
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });

  it("아주 밝은 색 점은 흰 면에서 사라지지 않게 테두리를 가진다", () => {
    const dot = dotProps("#ffffff");
    expect(dot.style?.backgroundColor).toBe("#ffffff");
    expect(String(dot.style?.boxShadow)).toContain("inset");
  });

  it("알 수 없는 값이 흘러들어도 색을 잃지 않는다(primary 폴백)", () => {
    expect(dotProps("nope").className).toBe("bg-primary");
    expect(chipProps("nope").className).toBe("bg-primary-soft text-primary");
  });
});

describe("isCustomColor / colorLabel", () => {
  it("프리셋과 hex를 가른다", () => {
    expect(isCustomColor("#aabbcc")).toBe(true);
    expect(isCustomColor("blue")).toBe(false);
    expect(isCustomColor("garbage")).toBe(false);
  });

  it("이름은 프리셋이면 한글, hex면 코드 그대로(영문 enum 노출 금지 규칙)", () => {
    expect(colorLabel("purple")).toBe("보라");
    expect(colorLabel("#aabbcc")).toBe("#AABBCC");
  });
});

describe("darkenHexForContrast", () => {
  it("이미 대비가 충분하면 원본 그대로 둔다(괜히 어둡게 만들지 않는다)", () => {
    expect(darkenHexForContrast("#153e75", "#ffffff", 4.5)).toBe("#153e75");
  });

  it("밝은 색은 목표 대비까지 낮추되 색상각은 유지한다", () => {
    const out = darkenHexForContrast("#ffff00", "#ffffff", 4.5);
    expect(contrastRatio(out, "#ffffff")!).toBeGreaterThanOrEqual(4.5);
    expect(out.slice(5, 7)).toBe("00"); // 파랑 성분 0 — 노랑 계열 유지
  });

  it("흰색처럼 극단적인 입력에서도 수렴한다(검정은 항상 목표를 넘는다)", () => {
    const out = darkenHexForContrast("#ffffff", "#ffffff", 4.5);
    expect(contrastRatio(out, "#ffffff")!).toBeGreaterThanOrEqual(4.5);
  });

  it("형식이 틀리면 빈 문자열(호출부가 폴백을 고를 수 있게)", () => {
    expect(darkenHexForContrast("not-a-color", "#ffffff", 4.5)).toBe("");
  });
});

describe("compositeOver", () => {
  it("틴트를 흰 면에 합성하면 그만큼 옅어진 불투명색이 된다", () => {
    expect(compositeOver("#000000", 0.5, "#ffffff")).toBe("#808080");
    expect(compositeOver("#ff0000", 0, "#ffffff")).toBe("#ffffff"); // 완전 투명 = 배경 그대로
  });
});
