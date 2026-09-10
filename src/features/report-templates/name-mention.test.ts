import { describe, expect, it } from "vitest";
import { mentionsStudentName, studentNameVariants } from "./name-mention";

describe("studentNameVariants", () => {
  it("성+이름과 이름만", () => {
    expect(studentNameVariants("공서연")).toEqual(["공서연", "서연"]);
  });

  it("동명이인 접미 알파벳은 뗀다", () => {
    expect(studentNameVariants("박서연C")).toEqual(["박서연", "서연"]);
  });

  it("두 글자 성은 두 글자를 뗀다", () => {
    expect(studentNameVariants("남궁민수")).toEqual(["남궁민수", "민수"]);
  });

  it("두 글자 이름은 한 글자만 남기지 않는다(오탐 방지)", () => {
    expect(studentNameVariants("이윤")).toEqual(["이윤"]);
  });

  it("영어 이름을 더한다", () => {
    expect(studentNameVariants("공서연", "Sally")).toEqual(["공서연", "서연", "Sally"]);
  });
});

describe("mentionsStudentName", () => {
  it("이름만 불러도 인정", () => {
    expect(mentionsStudentName("오늘 서연이는 발표를 잘했어요", "공서연")).toBe(true);
  });

  it("이름이 없으면 false", () => {
    expect(mentionsStudentName("오늘 발표를 잘했어요", "공서연")).toBe(false);
  });

  it("두 글자 이름의 한 글자만으로는 인정하지 않는다", () => {
    expect(mentionsStudentName("윤기 나는 발표", "이윤")).toBe(false);
    expect(mentionsStudentName("이윤 학생이 발표", "이윤")).toBe(true);
  });

  it("영어 이름은 대소문자 무관", () => {
    expect(mentionsStudentName("SALLY did great", "공서연", "Sally")).toBe(true);
  });

  it("🔴 로마자 이름을 통째로 지우지 않는다(지우면 늘 통과)", () => {
    expect(studentNameVariants("Kevin")).toEqual(["Kevin"]);
    expect(mentionsStudentName("오늘 수업을 잘 마쳤습니다", "Kevin")).toBe(false);
    expect(mentionsStudentName("Kevin은 잘했습니다", "Kevin")).toBe(true);
  });

  it("두 글자 성 + 한 글자 이름은 성+이름만 인정", () => {
    expect(studentNameVariants("남궁민")).toEqual(["남궁민"]);
  });

  it("🔴 흔한 낱말인 이름은 낱말로 쓰였을 때만 인정", () => {
    expect(mentionsStudentName("오답을 수정해 주세요", "김수정")).toBe(false);
    expect(mentionsStudentName("수정이는 잘했습니다", "김수정")).toBe(true);
    expect(mentionsStudentName("오늘 수정 학생이 발표했습니다", "김수정")).toBe(true);
  });

  it("자주 쓰는 조사 뒤도 인정한다(랑·처럼·보다·께서·으로)", () => {
    for (const t of ["지우랑 함께", "지우처럼 해 봐요", "지우보다 빨라요", "지우께서", "서연으로서"]) {
      const name = t.startsWith("지우") ? "김지우" : "공서연";
      expect(mentionsStudentName(t, name)).toBe(true);
    }
  });

  it("판정할 이름이 없으면 막지 않는다", () => {
    expect(mentionsStudentName("아무 글", "")).toBe(true);
    expect(mentionsStudentName("아무 글", null)).toBe(true);
  });
});
