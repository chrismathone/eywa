import { describe, it, expect } from "vitest";
import { reasonDisplay, reasonLabel } from "./types";

describe("reasonDisplay — 화면 표시용 퇴원 사유", () => {
  it("표준 코드는 한글로", () => {
    expect(reasonDisplay("graduated")).toBe("졸업");
    expect(reasonDisplay("dissatisfaction")).toBe("수업·강사");
  });

  // 2026-07-21 회귀: injaewon에 ijw 표기(dissatisfied) 5건이 있는데 영문 raw가 그대로 노출됐다.
  it("임포트 표기 흔들림(alias)도 한글로 — 영문 raw 노출 금지", () => {
    expect(reasonDisplay("dissatisfied")).toBe("수업·강사");
    expect(reasonDisplay("moved")).toBe("이사");
    expect(reasonDisplay("graduate")).toBe("졸업");
    expect(reasonDisplay("cost")).toBe("경제적 이유");
  });

  it("자유 텍스트는 보존 — reasonLabel과 갈리는 지점", () => {
    expect(reasonDisplay("반 이동")).toBe("반 이동");
    expect(reasonLabel("반 이동")).toBe("기타"); // 대비: 이쪽은 '기타'로 뭉갠다
  });

  it("빈 값은 null", () => {
    expect(reasonDisplay(null)).toBeNull();
    expect(reasonDisplay(undefined)).toBeNull();
    expect(reasonDisplay("")).toBeNull();
  });
});
