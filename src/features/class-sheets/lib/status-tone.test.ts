import { describe, expect, it } from "vitest";
import { statusTone } from "./status-tone";

describe("statusTone", () => {
  it("빈 값·미입력은 중립", () => {
    expect(statusTone(null)).toBe("neutral");
    expect(statusTone("")).toBe("neutral");
    expect(statusTone("   ")).toBe("neutral");
  });

  it("칩 3종(완/결석/안침)을 각각 다른 톤으로 가른다", () => {
    expect(statusTone("완")).toBe("done");
    expect(statusTone("결석")).toBe("absent");
    expect(statusTone("안침")).toBe("warn");
  });

  it("실 시트 문장형 상태도 색이 붙는다(부분일치)", () => {
    // 원본 시트 실측 값
    expect(statusTone("할머니집 가서 결석")).toBe("absent");
    expect(statusTone("지각해서 리딩 미완")).toBe("warn");
    expect(statusTone("결석(여행)")).toBe("absent");
  });

  it("'미완'이 '완'으로 오인되지 않는다(순서 규칙)", () => {
    expect(statusTone("미완")).toBe("warn");
    expect(statusTone("과제 미완")).toBe("warn");
    expect(statusTone("과제 완")).toBe("done");
  });

  it("모르는 어휘는 중립(색을 지어내지 않는다)", () => {
    expect(statusTone("교재 가져옴")).toBe("neutral");
  });
});
