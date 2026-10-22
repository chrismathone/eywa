import { expect, it } from "vitest";
import { parentStudentGivenName, parentStudentName } from "./student-name";

it("학부모용 이름은 동명이인 구분용 알파벳만 빼고 성을 유지한다", () => {
  expect(parentStudentName(" 김민서G ")).toBe("김민서");
  expect(parentStudentName("김민서")).toBe("김민서");
  expect(parentStudentName("Mary Jane")).toBe("Mary Jane");
  expect(parentStudentName("AJ")).toBe("AJ");
});

it("이름만 쓸 때는 한글 성을 분리하고, 짧거나 모호한 이름·영문 이름은 전체를 유지한다", () => {
  expect(parentStudentGivenName("김민서G")).toBe("민서");
  expect(parentStudentGivenName("남궁민수A")).toBe("민수");
  expect(parentStudentGivenName("남궁민")).toBe("남궁민");
  expect(parentStudentGivenName("이윤B")).toBe("이윤");
  expect(parentStudentGivenName("Alex")).toBe("Alex");
  expect(parentStudentGivenName("Mary Jane")).toBe("Mary Jane");
});
