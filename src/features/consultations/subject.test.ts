import { describe, expect, it } from "vitest";
import { consultationSubject } from "./subject";

describe("consultationSubject", () => {
  it("fills a single counselor subject from tenant labels", () => {
    expect(consultationSubject(null, ["english"], { english: "영어" })).toBe("영어");
  });

  it("preserves an explicitly entered subject", () => {
    expect(consultationSubject("수학", ["english"], { english: "영어" })).toBe("수학");
  });

  it("does not guess for a counselor with two or no subjects", () => {
    expect(consultationSubject(null, ["english", "math"], {})).toBeNull();
    expect(consultationSubject(null, [], {})).toBeNull();
  });
});
