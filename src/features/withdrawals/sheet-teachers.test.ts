import { describe, expect, it } from "vitest";
import { buildSheetTeacherIndex, sheetSubjectKey, sheetTeachersFor } from "./sheet-teachers";

const head = ["", "2026.06월 학습종료퇴원 학생명", "학교/학년", "반명", "과목", "담당선생님", "재원캠퍼스", "등록일", "최종퇴원일", "재원기간(개월)"];
const tab = (title: string, rows: string[][]) => ({ title, rows: [head, ...rows] });

describe("퇴원생 관리 차트 담당선생님", () => {
  const index = buildSheetTeacherIndex([
    tab("26.6 퇴원", [
      ["1", "태유정", "침산중2", "중등M 중2 PS2S", "수학", "김화영", "", "", "26.07.08", ""],
      ["2", "김 도연c", "", "", "영어", "신명진", "", "", "", ""],
      ["3", "조예나", "", "", "수학", "김윤하/김은정", "", "", "", ""],
    ]),
    tab("26.11 퇴원", [["1", "새학생", "", "", "수학", "이성우", "", "", "", ""]]),
    tab("퇴원대시보드", [["x"]]),
  ]);
  it("이름(띄어쓰기·대소문자 무시)·과목·달로 찾는다 · 여러 선생님은 모두", () => {
    expect(sheetTeachersFor(index, { name: "태유정", subject: "math", months: ["2026-06"] })).toEqual(["김화영"]);
    expect(sheetTeachersFor(index, { name: "김도연C", subject: "english", months: ["2026-06"] })).toEqual(["신명진"]);
    expect(sheetTeachersFor(index, { name: "조예나", subject: "math", months: ["2026-06"] })).toEqual(["김윤하", "김은정"]);
    expect(sheetTeachersFor(index, { name: "태유정", subject: "english", months: ["2026-06"] })).toBeNull();
  });
  it("🔴 한 달 어긋남은 앞뒤 한 달까지 찾는다(시트는 7/8 퇴원을 6월 탭에 적었다)", () => {
    expect(sheetTeachersFor(index, { name: "태유정", subject: "math", months: ["2026-07"] })).toEqual(["김화영"]);
    expect(sheetTeachersFor(index, { name: "태유정", subject: "math", months: ["2026-09"] })).toBeNull();
  });
  it("🔴 시트를 쓰는 마지막 달(2026-10) 뒤는 에이와 데이터로만 — 11월 탭은 읽지 않고, 11월 줄은 앞 달로 넘어가지 않는다", () => {
    expect(sheetTeachersFor(index, { name: "새학생", subject: "math", months: ["2026-11"] })).toBeNull();
  });
  it("과목 글", () => {
    expect([sheetSubjectKey("수학"), sheetSubjectKey("EIE"), sheetSubjectKey("영어"), sheetSubjectKey("과학")]).toEqual(["math", "english", "english", null]);
  });
});

describe("시트 글 나누기", () => {
  it("학교/학년 · 이름 키", async () => {
    const { splitSchoolGrade, nameKey } = await import("./sheet-teachers");
    expect(splitSchoolGrade("경명여중1")).toEqual({ school: "경명여중", grade: "중1" });
    expect(splitSchoolGrade("달성초6")).toEqual({ school: "달성초", grade: "초6" });
    expect(splitSchoolGrade("")).toEqual({ school: null, grade: null });
    expect([nameKey("김 도연c"), nameKey("권민서A", true), nameKey("JAKE", true)]).toEqual(["김도연C", "권민서", "JAKE"]);
  });
});

describe("시트 선생님 별칭", () => {
  it("원장이 확인한 같은 사람 — 시트 '김정은' = 계정 '김은정'", async () => {
    const { sheetTeacherName } = await import("./sheet-teachers");
    expect([sheetTeacherName("김정은"), sheetTeacherName(" 김은정 "), sheetTeacherName("김화영")]).toEqual(["김은정", "김은정", "김화영"]);
  });
});
