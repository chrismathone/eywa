import { describe, expect, it } from "vitest";
import { checkTemplateInput } from "./validate";

describe("checkTemplateInput — 사진·PDF 자리 줄", () => {
  it("🔴 템플릿엔 첨부 자리 줄을 넣을 수 없다(첨부는 보고서마다 올리는 파일)", () => {
    const res = checkTemplateInput({ name: "안내", body: "{학생}\n[첨부: 안내.pdf]" });
    expect(res.ok).toBe(false);
    expect(res.ok ? "" : res.error).toContain("사진·PDF 넣기");
  });

  it("문장 속 글자는 자리 줄이 아니라 그대로 저장된다", () => {
    expect(checkTemplateInput({ name: "안내", body: "{학생} 사진은 [첨부: 안내.pdf] 참고" }).ok).toBe(true);
  });
});
