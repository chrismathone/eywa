import { describe, expect, it } from "vitest";
import { BUILTIN_ENGLISH_TEMPLATE, ENGLISH_TEMPLATE_TOKEN_KEYS, TEMPLATE_BODY_MAX } from "./defaults";
import { fillReportTemplate, templateTokens } from "./fill";

describe("기본 영어 템플릿", () => {
  it("쓰는 토큰이 전부 토큰 목록에 있다(모르는 토큰이면 그 줄이 조용히 빠진다)", () => {
    const unknown = templateTokens(BUILTIN_ENGLISH_TEMPLATE.body).filter(
      (t) => !(ENGLISH_TEMPLATE_TOKEN_KEYS as readonly string[]).includes(t),
    );
    expect(unknown).toEqual([]);
  });

  it("본문 상한 안에 들어간다", () => {
    expect(BUILTIN_ENGLISH_TEMPLATE.body.length).toBeLessThan(TEMPLATE_BODY_MAX);
  });

  it("사용자가 보내 준 EiE 글 모양으로 채워진다", () => {
    const r = fillReportTemplate(BUILTIN_ENGLISH_TEMPLATE.body, {
      학생: "공서연",
      작성자: "부원장",
      인사말: "밝고 활기찬 에너지로 수업에 참여했습니다.",
      진도:
        "원어민 선생님 수업 : Classroom English 발화 연습 + e-book Book Report\n" +
        "부원장 선생님 수업 : Unit 1~3 핵심 내용 전체 리뷰",
      테스트: "단어 테스트 진행 (31~40번)",
      숙제: "Work Book : p.30~33 풀어오기",
      다음테스트: "단어 시험 : 71~80번",
      코멘트: "서연이가 구문 감각을 잘 발휘해 주었습니다.",
    });
    expect(r.unknownTokens).toEqual([]);
    expect(r.text.startsWith("안녕하세요 학부모님, 부원장입니다! 😊❤️\n\n밝고 활기찬")).toBe(true);
    expect(r.text).toContain("📍 오늘의 진도\n원어민 선생님 수업 :");
    expect(r.text).toContain("테스트 : 단어 테스트 진행 (31~40번)");
    expect(r.text).toContain("💡 다음 시간 테스트 안내\n단어 시험 : 71~80번\n(※ 오늘 재시가");
    expect(r.text.endsWith("💌 부원장 코멘트 (Feedback)\n서연이가 구문 감각을 잘 발휘해 주었습니다.")).toBe(true);
  });

  it("다음 테스트가 없으면 재시험 안내 문장까지 문단째 빠진다", () => {
    const r = fillReportTemplate(BUILTIN_ENGLISH_TEMPLATE.body, {
      작성자: "부원장",
      인사말: "",
      진도: "Unit 4",
      테스트: "",
      숙제: "",
      다음테스트: "",
      코멘트: "좋았습니다.",
    });
    expect(r.text).not.toContain("재시가");
    expect(r.text).not.toContain("📅 오늘의 숙제");
    expect(r.text).toContain("📍 오늘의 진도\nUnit 4");
  });
});
