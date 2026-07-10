import { describe, expect, it } from "vitest";
import {
  candidatesByExactName,
  candidatesByNormName,
  isEdutrixDummyStudent,
  pickEywaForEdutrixStudent,
  resolveEywaIdByEdutrixId,
  type EywaStudentLite,
} from "./edutrix-match";

const base = (p: Partial<EywaStudentLite> & { id: string; name: string }): EywaStudentLite => ({
  school: null,
  grade: null,
  status: "enrolled",
  ...p,
});

describe("pickEywaForEdutrixStudent", () => {
  it("unique name → map", () => {
    const r = pickEywaForEdutrixStudent(
      { id: "e1", name: "김서윤" },
      [base({ id: "a", name: "김서윤", school: "경명여고", grade: "고2" })],
    );
    expect(r).toEqual({ kind: "mapped", eywaId: "a", reason: "unique_name" });
  });

  it("multi name + school/grade → map", () => {
    const r = pickEywaForEdutrixStudent(
      { id: "e1", name: "김서윤", school: "경명여고", grade: "고2" },
      [
        base({ id: "a", name: "김서윤", school: "경명여고", grade: "고2" }),
        base({ id: "b", name: "김서윤", school: "일중", grade: "중1" }),
      ],
    );
    expect(r).toEqual({ kind: "mapped", eywaId: "a", reason: "school_grade" });
  });

  it("multi name both enrolled same school unknown → ambiguous", () => {
    const r = pickEywaForEdutrixStudent(
      { id: "e1", name: "김서윤" },
      [
        base({ id: "a", name: "김서윤", school: "경명여고", grade: "고2" }),
        base({ id: "b", name: "김서윤", school: "일중", grade: "중1" }),
      ],
    );
    expect(r.kind).toBe("ambiguous");
  });

  it("multi name one enrolled → map enrolled_only", () => {
    const r = pickEywaForEdutrixStudent(
      { id: "e1", name: "김채은" },
      [
        base({ id: "a", name: "김채은", status: "enrolled", school: "경명여고", grade: "고1" }),
        base({ id: "b", name: "김채은", status: "withdrawn", school: "일중", grade: "중1" }),
      ],
    );
    expect(r).toEqual({ kind: "mapped", eywaId: "a", reason: "enrolled_only" });
  });

  it("no candidates → none", () => {
    const r = pickEywaForEdutrixStudent({ id: "e1", name: "없는애" }, []);
    expect(r).toEqual({ kind: "none", reason: "no_name_match" });
  });
});

describe("name helpers + resolve", () => {
  it("norm name matches trailing space", () => {
    const eywa = [base({ id: "a", name: "송준영" })];
    expect(candidatesByExactName("송준영 ", eywa)).toHaveLength(0);
    expect(candidatesByNormName("송준영 ", eywa)).toHaveLength(1);
  });

  it("runtime resolve is map-only no name fallback", () => {
    const m = new Map([["edu-uuid", "eywa-uuid"]]);
    expect(resolveEywaIdByEdutrixId("edu-uuid", m)).toBe("eywa-uuid");
    expect(resolveEywaIdByEdutrixId("other", m)).toBeNull();
  });
});

describe("isEdutrixDummyStudent", () => {
  it("학원N / 테스트 이름", () => {
    expect(isEdutrixDummyStudent({ name: "학원삼", school: "미입력", grade: "미정" })).toBe(true);
    expect(isEdutrixDummyStudent({ name: "테스트김", school: "칠성중", grade: "중1" })).toBe(true);
  });

  it("프로필 미기재(미입력/미정) 실학생은 더미 아님 — 이름 패턴만 판정(플레이스홀더 규칙 폐기, 2026-07-10)", () => {
    expect(isEdutrixDummyStudent({ name: "김보미", school: "미입력", grade: "미정" })).toBe(false);
  });

  it("실학생 — 학교 있으면 더미 아님", () => {
    expect(isEdutrixDummyStudent({ name: "김보미", school: "경명여중", grade: "중1" })).toBe(false);
  });
});
