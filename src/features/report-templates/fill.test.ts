import { describe, expect, it } from "vitest";
import { fillReportTemplate, normalizeTokenName, templateTokens } from "./fill";

const NUL = String.fromCharCode(0);

describe("fillReportTemplate — 치환·조사", () => {
  it("토큰을 값으로 바꾸고 뒤 조사를 받침에 맞춘다", () => {
    expect(fillReportTemplate("{학생}이 발표했어요", { 학생: "김지우" }).text).toBe("김지우가 발표했어요");
    expect(fillReportTemplate("{학생}가 발표했어요", { 학생: "김민준" }).text).toBe("김민준이 발표했어요");
    expect(fillReportTemplate("{학생}는 성실해요", { 학생: "공서연" }).text).toBe("공서연은 성실해요");
  });

  it("조사처럼 보여도 뒤에 한글이 이어지면 건드리지 않는다", () => {
    expect(fillReportTemplate("{진도}과제", { 진도: "Unit 3" }).text).toBe("Unit 3과제");
  });

  it("토큰 이름의 공백은 무시한다", () => {
    expect(normalizeTokenName("다음 테스트")).toBe("다음테스트");
    expect(fillReportTemplate("다음: {다음 테스트}", { 다음테스트: "71~80번" }).text).toBe("다음: 71~80번");
  });

  it("🔴 템플릿에 일부러 넣은 간격은 그대로 둔다(빈 자리만 손본다)", () => {
    const t = "안녕하세요  학부모님, {작성자}입니다!";
    expect(fillReportTemplate(t, { 작성자: "부원장" }).text).toBe("안녕하세요  학부모님, 부원장입니다!");
  });

  it("여러 줄 값은 줄바꿈째 들어간다", () => {
    const r = fillReportTemplate("📍 오늘의 진도\n{진도}", {
      진도: "원어민 선생님 수업 : e-book\n부원장 선생님 수업 : Unit 1~3 리뷰",
    });
    expect(r.text).toBe("📍 오늘의 진도\n원어민 선생님 수업 : e-book\n부원장 선생님 수업 : Unit 1~3 리뷰");
  });

  it("CRLF 템플릿도 같은 결과", () => {
    expect(fillReportTemplate("가\r\n{a}\r\n\r\n나", { a: "x" }).text).toBe("가\nx\n\n나");
  });
});

describe("fillReportTemplate — 빈 칸이 드러나지 않게", () => {
  it("줄의 토큰이 전부 비면 그 줄을 지운다", () => {
    const r = fillReportTemplate("테스트 : {테스트}\n숙제 : {숙제}", { 테스트: "", 숙제: "WB p.30~33" });
    expect(r.text).toBe("숙제 : WB p.30~33");
  });

  it("토큰 줄이 하나도 안 남은 문단은 머리말째 지운다", () => {
    const t = "인사\n\n💡 다음 시간 테스트 안내\n단어 시험 : {다음테스트}\n\n맺음";
    expect(fillReportTemplate(t, { 다음테스트: null }).text).toBe("인사\n\n맺음");
  });

  it("토큰이 원래 없던 문단은 남긴다", () => {
    expect(fillReportTemplate("늘 진심을 다하겠습니다", {}).text).toBe("늘 진심을 다하겠습니다");
  });

  it("값이 빈 토큰의 조사도 함께 없앤다", () => {
    const r = fillReportTemplate("{a}와 {b} 진행", { a: "", b: "단어 시험" });
    expect(r.text).toBe("단어 시험 진행");
  });

  it("모르는 토큰은 빈 값으로 보고 따로 알린다 — 중괄호가 학부모에게 나가지 않는다", () => {
    const r = fillReportTemplate("진도: {진도2}\n숙제: {숙제}", { 숙제: "WB" });
    expect(r.text).toBe("숙제: WB");
    expect(r.unknownTokens).toEqual(["진도2"]);
    expect(r.text).not.toContain("{");
  });

  it("빈 자리 표시가 결과에 남지 않는다", () => {
    const r = fillReportTemplate("원어민: {a} / 부원장: {b}", { a: "", b: "Unit 1" });
    expect(r.text).not.toContain(NUL);
    expect(r.text).toContain("부원장: Unit 1");
  });

  it("값이나 템플릿에 NUL이 섞여 와도 결과에 남지 않는다", () => {
    const r = fillReportTemplate(`가${NUL}나 {a}`, { a: `x${NUL}y` });
    expect(r.text).toBe("가나 xy");
  });
});

describe("fillReportTemplate — 꾸밈 토큰·호칭", () => {
  it("🔴 꾸밈 토큰만 남은 머리말은 내용이 비면 문단째 빠진다(빈 '코멘트' 머리말 방지)", () => {
    const t = "안녕하세요, {작성자}입니다\n\n💌 {작성자} 코멘트\n{코멘트}";
    const opts = { decorationTokens: ["작성자", "학생"] };
    expect(fillReportTemplate(t, { 작성자: "정유진 선생님", 코멘트: "" }, opts).text).toBe("안녕하세요, 정유진 선생님입니다");
    expect(fillReportTemplate(t, { 작성자: "정유진 선생님", 코멘트: "잘했어요" }, opts).text).toBe(
      "안녕하세요, 정유진 선생님입니다\n\n💌 정유진 선생님 코멘트\n잘했어요",
    );
  });

  it("{학생}이는 — 받침 없는 이름이면 '이'를 뺀다", () => {
    expect(fillReportTemplate("{학생}이는 성실해요", { 학생: "김지우" }).text).toBe("김지우는 성실해요");
    expect(fillReportTemplate("{학생}이는 성실해요", { 학생: "김민준" }).text).toBe("김민준이는 성실해요");
  });

  it("🔴 이름이 비면 호칭 조사까지 지운다 · 다른 칸의 '이'는 건드리지 않는다", () => {
    expect(fillReportTemplate("{학생}이는 {진도}를 했어요", { 학생: "", 진도: "Unit 3" }).text).toBe("Unit 3을 했어요");
    expect(fillReportTemplate("{숙제}이만큼", { 숙제: "WB" }).text).toBe("WB이만큼");
  });

  it("🔴 내용 칸이 다 빈 줄은 꾸밈 칸이 차 있어도 뺀다", () => {
    const opts = { decorationTokens: ["학생", "작성자"] };
    const r = fillReportTemplate("오늘 {학생}이는 {인사말}\n진도: {진도}", { 학생: "김민준", 인사말: "", 진도: "Unit 3" }, opts);
    expect(r.text).toBe("진도: Unit 3");
  });
});

describe("templateTokens", () => {
  it("등장 순서대로 중복 없이", () => {
    expect(templateTokens("{학생} {진도} {학생} {다음 테스트}")).toEqual(["학생", "진도", "다음테스트"]);
  });
});

describe("EiE 형태 템플릿 — 전체 흐름", () => {
  const TEMPLATE = [
    "안녕하세요 학부모님, {작성자}입니다! 😊❤️",
    "",
    "{인사말}",
    "",
    "📍 오늘의 진도",
    "{진도}",
    "테스트 : {테스트}",
    "",
    "📅 오늘의 숙제",
    "{숙제}",
    "",
    "💡 다음 시간 테스트 안내",
    "{다음테스트}",
    "",
    "💌 {작성자} 코멘트 (Feedback)",
    "{코멘트}",
  ].join("\n");

  it("다음 테스트가 없으면 그 문단만 빠지고 나머지는 이어진다", () => {
    const r = fillReportTemplate(TEMPLATE, {
      작성자: "부원장",
      인사말: "서연이가 밝은 에너지로 수업에 참여했습니다.",
      진도: "부원장 선생님 수업 : Unit 1~3 리뷰",
      테스트: "단어 테스트 (31~40번)",
      숙제: "Work Book : p.30~33",
      다음테스트: "",
      코멘트: "서연이가 구문을 척척 찾아냈습니다.",
    });
    expect(r.text).not.toContain("다음 시간 테스트 안내");
    expect(r.text).toContain("💌 부원장 코멘트 (Feedback)\n서연이가 구문을 척척 찾아냈습니다.");
    expect(r.text).toContain("📍 오늘의 진도\n부원장 선생님 수업 : Unit 1~3 리뷰\n테스트 : 단어 테스트 (31~40번)");
    expect(r.text).not.toMatch(/\n{3,}/);
    expect(r.unknownTokens).toEqual([]);
  });
});
