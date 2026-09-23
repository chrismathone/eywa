import { describe, expect, it } from "vitest";
import { linkedRecordKeyOf, preserveConsultationLink, visibleConsultationSummary } from "./internal-link";
import { consultationPreview } from "./summary-preview";

const key = "report:33333333-3333-4333-8333-333333333333:legacy";
const stored = `성적 상담 [EYWA-UNIFIED:${key}]`;

describe("상담 내부 시험 키", () => {
  it("목록·상세·편집 폼에 전달할 본문과 미리보기에서 내부 키를 숨긴다", () => {
    expect(linkedRecordKeyOf(stored)).toBe(key);
    expect(visibleConsultationSummary(stored)).toBe("성적 상담");
    expect(consultationPreview(stored)).toBe("성적 상담");
  });

  it("편집 본문을 저장할 때 기존 키를 한 번만 보존한다", () => {
    expect(preserveConsultationLink("상담 후 보충 예정", stored))
      .toBe(`상담 후 보충 예정 [EYWA-UNIFIED:${key}]`);
    expect(preserveConsultationLink(`상담 후 보충 예정 [EYWA-UNIFIED:${key}]`, stored))
      .toBe(`상담 후 보충 예정 [EYWA-UNIFIED:${key}]`);
  });

  it("사용자 입력의 키는 새 연결을 만들지 않고, 다른 상담의 키도 붙이지 않는다", () => {
    expect(visibleConsultationSummary(`임의 입력 [EYWA-UNIFIED:${key}]`)).toBe("임의 입력");
    expect(preserveConsultationLink(`임의 입력 [EYWA-UNIFIED:${key}]`, "일반 상담")).toBe("임의 입력");
    expect(linkedRecordKeyOf("성적 상담")).toBeNull();
    expect(visibleConsultationSummary("일반 상담\n")).toBe("일반 상담\n");
  });
});
