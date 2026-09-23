import { describe, expect, it } from "vitest";
import { mergeSpeakerRoles } from "./speaker-roles";

describe("mergeSpeakerRoles", () => {
  it("사람이 정한 라벨은 AI 값이 덮지 않는다", () => {
    expect(mergeSpeakerRoles({ A: "원장" }, { A: "강사", B: "학부모" })).toEqual({ A: "원장", B: "학부모" });
  });
  it("빈 화자만 AI 값으로 채운다", () => {
    expect(mergeSpeakerRoles({ A: "  " }, { A: "강사" })).toEqual({ A: "강사" });
    expect(mergeSpeakerRoles(null, { A: "강사" })).toEqual({ A: "강사" });
  });
  it("AI가 비어도 기존 라벨은 남는다", () => {
    expect(mergeSpeakerRoles({ A: "원장" }, {})).toEqual({ A: "원장" });
    expect(mergeSpeakerRoles(["x"], undefined)).toEqual({});
  });
});
