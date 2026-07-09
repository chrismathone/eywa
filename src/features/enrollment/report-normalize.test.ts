import { describe, expect, it } from "vitest";
import { cleanQaTags, isIncompleteItem, normalizeAiListText } from "./report-normalize";

describe("normalizeAiListText — 런온(' - ') 분리", () => {
  it("한 줄에 ' - '로 이어붙인 항목을 줄바꿈으로 분리", () => {
    expect(normalizeAiListText("- 첫째 항목이다 - 둘째 항목이다 - 셋째 항목이다")).toBe(
      "첫째 항목이다\n둘째 항목이다\n셋째 항목이다",
    );
  });
  it("숫자 천단위 콤마(288,000원)는 쪼개지 않는다", () => {
    expect(normalizeAiListText("- 수업료 12회에 288,000원 - 교재 사용함")).toBe(
      "수업료 12회에 288,000원\n교재 사용함",
    );
  });
  it("항목 내부 괄호 안 쉼표·하이픈 없는 텍스트는 그대로", () => {
    expect(normalizeAiListText("- 화수금 주 3회로 구성(화금 담임, 수 부장)")).toBe(
      "화수금 주 3회로 구성(화금 담임, 수 부장)",
    );
  });
});

describe("normalizeAiListText — 조각 병합(연결어미로 잘림)", () => {
  it("~이며 로 끝난 조각을 다음과 병합(→ ~다로 완결)", () => {
    expect(
      normalizeAiListText("학부모는 학생의 성적이 60점대이며\n고등학교 입시 압박감을 가지고 있다."),
    ).toBe("학부모는 학생의 성적이 60점대이며 고등학교 입시 압박감을 가지고 있다.");
  });
  it("~하며 로 끝난 조각 병합", () => {
    expect(
      normalizeAiListText("인출학습의 필요성 등을 우려하며\n현재 방식에 불만을 가지고 있다."),
    ).toBe("인출학습의 필요성 등을 우려하며 현재 방식에 불만을 가지고 있다.");
  });
  it("매달린 조사(등을)·쉼표로 끝나면 병합", () => {
    expect(normalizeAiListText("성공 사례 등을\n제시함")).toBe("성공 사례 등을 제시함");
    expect(normalizeAiListText("화금 담임,\n수 부장 배정")).toBe("화금 담임, 수 부장 배정");
  });
  it("완결(~다/~함/명사)로 끝난 항목은 병합하지 않는다", () => {
    expect(normalizeAiListText("개념 이해 부족\n답답함을 표현함")).toBe("개념 이해 부족\n답답함을 표현함");
    expect(normalizeAiListText("등록하기로 합의했다\n주 3회 수업이다")).toBe(
      "등록하기로 합의했다\n주 3회 수업이다",
    );
  });
});

describe("normalizeAiListText — 학부모 질문(Q&A)", () => {
  it("런온 Q&A는 질문별 한 줄로, 화살표 답변은 인라인 유지", () => {
    expect(
      normalizeAiListText("- 시험은 몇 점인지? → (미답변) - 교재는 무엇인지? → (미답변)"),
    ).toBe("시험은 몇 점인지? → (미답변)\n교재는 무엇인지? → (미답변)");
  });
  it("답변(→)이 새 줄이어도 앞 항목과 병합하지 않는다(하위줄 유지)", () => {
    expect(normalizeAiListText("교재는 무엇인지?\n→ (미답변)")).toBe("교재는 무엇인지?\n→ (미답변)");
  });
});

describe("normalizeAiListText — 정리/경계", () => {
  it("빈·공백 입력은 빈 문자열", () => {
    expect(normalizeAiListText("")).toBe("");
    expect(normalizeAiListText("   \n  ")).toBe("");
  });
  it("이미 깔끔한 다중 줄은 마커만 제거하고 유지", () => {
    expect(normalizeAiListText("- 첫째다\n- 둘째다")).toBe("첫째다\n둘째다");
  });
  it("런온 + 조각 병합 혼합", () => {
    expect(
      normalizeAiListText("- 학생은 60점대이며 - 고등 진학 압박이 있다 - 개념 부족"),
    ).toBe("학생은 60점대이며 고등 진학 압박이 있다\n개념 부족");
  });
  it("중복 공백 축약", () => {
    expect(normalizeAiListText("-   항목   하나다")).toBe("항목 하나다");
  });
});

describe("cleanQaTags — (미답변)/(답변) 태그 교정", () => {
  it("'(미답변)' 뒤에 답변 내용이 있으면 태그 제거(오라벨 교정)", () => {
    expect(cleanQaTags("성적이 안 오른 이유는? → (미답변) 공부법이 책과 실제가 다름")).toBe(
      "성적이 안 오른 이유는? → 공부법이 책과 실제가 다름",
    );
  });
  it("진짜 미답변('(미답변)' 뒤에 내용 없음)은 유지", () => {
    expect(cleanQaTags("교재는 무엇인지? → (미답변)")).toBe("교재는 무엇인지? → (미답변)");
  });
  it("'(답변)' 중복 태그는 제거", () => {
    expect(cleanQaTags("시간표는? → (답변) 방학 중에도 유지")).toBe("시간표는? → 방학 중에도 유지");
  });
  it("normalizeAiListText가 런온 Q&A의 오라벨까지 교정", () => {
    expect(
      normalizeAiListText("- 이유는? → (미답변) 공부법 차이 - 시간표는? → (답변) 유지됨"),
    ).toBe("이유는? → 공부법 차이\n시간표는? → 유지됨");
  });
});

describe("isIncompleteItem", () => {
  it.each([
    ["60점대이며", true],
    ["우려하며", true],
    ["지적하고", true],
    ["설명하여", true],
    ["필요성 등을", true],
    ["화금 담임,", true],
    ["가지고 있다", false],
    ["개념 이해 부족", false],
    ["표현함", false],
    ["2층 본원으로)", false],
    ["시험은 몇 점인지?", false],
  ])("%s → %s", (input, expected) => {
    expect(isIncompleteItem(input)).toBe(expected);
  });
});
