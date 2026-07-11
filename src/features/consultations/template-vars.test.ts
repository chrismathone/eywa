import { describe, it, expect } from "vitest";
import { fillTemplate, formatConsultDate } from "./template-vars";

describe("fillTemplate", () => {
  const vars = { date: "2026년 07월 11일", counselor: "박소선", student: "이윤건", grade: "중1" };

  it("알려진 태그를 값으로 치환(별칭 포함)", () => {
    expect(fillTemplate("{{날짜}} · 담당 {{담당}}", vars)).toBe("2026년 07월 11일 · 담당 박소선");
    expect(fillTemplate("{{오늘}}/{{상담사}}/{{학생명}}", vars)).toBe("2026년 07월 11일/박소선/이윤건");
  });

  it("공백이 섞인 태그도 치환", () => {
    expect(fillTemplate("{{ 날짜 }}", vars)).toBe("2026년 07월 11일");
  });

  it("값이 없으면 빈 문자열로 제거", () => {
    expect(fillTemplate("학생: {{학생}}", { date: "x" })).toBe("학생: ");
  });

  it("알 수 없는 태그는 원문 유지(오타 인지)", () => {
    expect(fillTemplate("{{존재안함}}", vars)).toBe("{{존재안함}}");
  });

  it("태그가 없으면 원문 그대로", () => {
    expect(fillTemplate("■ 상담 내용:", vars)).toBe("■ 상담 내용:");
  });

  it("여러 줄·반복 태그 모두 치환", () => {
    const body = "■ 일자: {{날짜}}\n■ 담당: {{담당}}\n■ 학생: {{학생}}({{학년}})";
    expect(fillTemplate(body, vars)).toBe("■ 일자: 2026년 07월 11일\n■ 담당: 박소선\n■ 학생: 이윤건(중1)");
  });
});

describe("formatConsultDate", () => {
  it("YYYY년 MM월 DD일(2자리 패딩)", () => {
    expect(formatConsultDate(new Date(2026, 6, 11))).toBe("2026년 07월 11일");
    expect(formatConsultDate(new Date(2026, 0, 3))).toBe("2026년 01월 03일");
  });

  it("유효하지 않은 날짜는 빈 문자열", () => {
    expect(formatConsultDate(new Date("invalid"))).toBe("");
  });
});
