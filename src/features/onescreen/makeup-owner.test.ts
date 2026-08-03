import { describe, it, expect } from "vitest";
import { ownsMakeupReport } from "./makeup-owner";

const ME = "u-1";
const MY_NAME = "이수진";

describe("ownsMakeupReport", () => {
  it("계정 id가 있으면 id로만 판정한다", () => {
    expect(ownsMakeupReport({ createdBy: ME, teacherName: "남" }, ME, MY_NAME)).toBe(true);
    expect(ownsMakeupReport({ createdBy: "u-2", teacherName: MY_NAME }, ME, MY_NAME)).toBe(false);
  });

  // 🔴 이름이 바뀌어도 내 보강은 내 화면에 남아야 한다 — 이 전환의 이유.
  it("이름이 바뀌어도 id가 같으면 내 것", () => {
    expect(ownsMakeupReport({ createdBy: ME, teacherName: "옛이름" }, ME, "새이름")).toBe(true);
  });

  // 🔴 동명이인이 생겨도 남의 보강이 새어 들어오면 안 된다(id가 있는 행에 이름 폴백 금지).
  it("id가 있는 남의 행은 이름이 같아도 안 열린다", () => {
    expect(ownsMakeupReport({ createdBy: "u-2", teacherName: MY_NAME }, ME, MY_NAME)).toBe(false);
  });

  it("id가 없는 옛 행만 이름으로 폴백", () => {
    expect(ownsMakeupReport({ createdBy: null, teacherName: MY_NAME }, ME, MY_NAME)).toBe(true);
    expect(ownsMakeupReport({ teacherName: "김은정" }, ME, MY_NAME)).toBe(false);
  });

  it("이름이 비면 폴백하지 않는다(빈 문자열끼리 매칭 금지)", () => {
    expect(ownsMakeupReport({ createdBy: null, teacherName: "" }, ME, "")).toBe(false);
    expect(ownsMakeupReport({ createdBy: null, teacherName: null }, ME, MY_NAME)).toBe(false);
  });
});
