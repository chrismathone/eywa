import { describe, expect, it } from "vitest";
import { contactPhoneLast4 } from "./contactPhoneTail";
import { studentSchema } from "./sync-contract";

describe("minimal student contact export", () => {
  it("prefers student phone, keeps leading zeros and returns no full phone", () => {
    expect(contactPhoneLast4("010-1234-0042", "010-5555-6789")).toBe("0042");
    expect(contactPhoneLast4("", "010-5555-0000")).toBe("0000");
    expect(contactPhoneLast4("123", "010-5555-6789")).toBe("6789");
    expect(contactPhoneLast4(null, "DO_NOT_EXPORT")).toBeNull();
  });
  it("keeps pre-extension snapshots compatible, validates only four digits", () => {
    const student = {
      id: "00000000-0000-4000-8000-000000000009",
      name: "김학생",
      grade: "중2",
      school: null,
      status: "enrolled",
      isTest: false,
    };
    expect(studentSchema.parse(student)).not.toHaveProperty("phoneLast4");
    expect(
      studentSchema.parse({ ...student, phoneLast4: "0042" }).phoneLast4,
    ).toBe("0042");
    expect(
      studentSchema.safeParse({ ...student, phoneLast4: "01012340042" })
        .success,
    ).toBe(false);
    expect(
      studentSchema.safeParse({ ...student, phoneLast4: "abcd" }).success,
    ).toBe(false);
  });
});
