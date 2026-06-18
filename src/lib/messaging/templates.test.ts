import { describe, expect, it } from "vitest";
import { buildAlimtalkVariables, pickTemplateId } from "./templates";

describe("buildAlimtalkVariables", () => {
  it("등록 템플릿 치환자 키에 값을 매핑", () => {
    expect(
      buildAlimtalkVariables({ studentName: "김철수", time: "16:05", academyName: "인재원" }),
    ).toEqual({ "#{학원명}": "인재원", "#{학생명}": "김철수", "#{시각}": "16:05" });
  });
  it("학원명 비면 기본값 '학원'", () => {
    expect(buildAlimtalkVariables({ studentName: "박민", time: "09:00", academyName: "" })["#{학원명}"]).toBe(
      "학원",
    );
  });
  it("값은 모두 문자열", () => {
    const v = buildAlimtalkVariables({ studentName: "이영희", time: "18:30", academyName: "인재원" });
    for (const val of Object.values(v)) expect(typeof val).toBe("string");
  });
});

describe("pickTemplateId", () => {
  const channel = { checkinTemplateId: "TPL_IN", checkoutTemplateId: "TPL_OUT" };
  it("등원 → checkinTemplateId", () => {
    expect(pickTemplateId("checkin", channel)).toBe("TPL_IN");
  });
  it("하원 → checkoutTemplateId", () => {
    expect(pickTemplateId("checkout", channel)).toBe("TPL_OUT");
  });
});
