import { describe, expect, it } from "vitest";
import { consultationPreview } from "./summary-preview";

describe("상담 목록 미리보기", () => {
  it("기본 양식의 날짜와 담당자 대신 실제 내용을 표시한다", () => {
    const raw =
      "✅ 상담 내역\n상담 기록 항목:\n2026년 09월 10일\n담당 선생님\n상담 내용:\n숙제 제출 방법을 안내함\n다음 주 확인 예정\n조치사항:\n추가 연락";
    expect(consultationPreview(raw)).toBe(
      "숙제 제출 방법을 안내함 다음 주 확인 예정",
    );
    expect(raw).toContain("2026년 09월 10일");
  });
  it("본문이 비었어도 작성한 후속 조치는 보존한다", () => {
    expect(
      consultationPreview("상담 내용:\n조치사항: 다음 주 전화\n비고:"),
    ).toBe("다음 주 전화");
  });
  it("빈 기본 양식을 실제 상담으로 가장하지 않는다", () => {
    expect(
      consultationPreview(
        "✅ 상담 내역\n상담 기록 항목:\n오늘\n상담 내용:\n조치사항:\n비고:",
      ),
    ).toBe("상담 내용 미입력");
  });
  it("자유 서술과 모르는 양식의 제목은 함부로 삭제하지 않는다", () => {
    expect(consultationPreview("학습 목표: x < 3\n학생의 질문")).toBe(
      "학습 목표: x < 3 학생의 질문",
    );
    expect(consultationPreview("상담 내용: x < 3 풀이를 설명함")).toBe(
      "x < 3 풀이를 설명함",
    );
    expect(consultationPreview(null)).toBe("상담 내용 미입력");
  });
});
