import { describe, expect, it } from "vitest";
import { sheetSchoolGrade } from "./school-grade";

describe("영어 시트 학교·학년", () => {
  it.each([
    ["침산초", "초5", "Chimsan ES5"],
    ["칠성초", "초4", "Chilseong ES4"],
    ["옥산초", "초5", "Oksan ES5"],
    ["달성초", "초6", "Dalseong ES6"],
    ["대구침산초등학교", "초3", "Chimsan ES3"],
    ["경명여자중학교", "중2", "Gyeongmyeong Girls’ MS2"],
    ["침산중", "중1", "Chimsan MS1"],
    ["경북고", "고2", "Gyeongbuk HS2"],
    ["대구초", "초1", "Daegu ES1"],
    ["Oak School", "초3", "Oak School ES3"],
    [null, "중2", "MS2"],
    ["칠성초", null, "Chilseong ES"],
    [null, null, ""],
    [null, "7세", "Age 7"],
    ["7세", "7세", "Age 7"],
  ])("%s / %s → %s", (school, grade, expected) => {
    expect(sheetSchoolGrade(school, grade, "en")).toBe(expected);
  });
  it("한국어 모드는 기존 압축 표기를 유지한다", () => {
    expect(sheetSchoolGrade("경명여중", "중1", "ko")).toBe("경명여중1");
  });
});
