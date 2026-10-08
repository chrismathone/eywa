import { describe, expect, it } from "vitest";
import { profilePayloadOf } from "./profile-payload";

describe("profilePayloadOf — 인재원에 보낼 학생 한 줄", () => {
  it("aywa 값 그대로", () => {
    expect(profilePayloadOf({ ijw_student_id: "ijwgsy", school: "대구일중", grade: "중2", birth_date: "2012-05-01" })).toEqual({
      ijwId: "ijwgsy",
      school: "대구일중",
      grade: "중2",
      birthDate: "2012-05-01",
    });
  });
  it("짝이 없으면 보내지 않는다", () => {
    expect(profilePayloadOf({ ijw_student_id: null, school: "x", grade: "중2", birth_date: null })).toBeNull();
    expect(profilePayloadOf({ ijw_student_id: "  ", school: "x", grade: "중2", birth_date: null })).toBeNull();
  });
  it("빈 값은 null(인재원에서도 지운다) · 생일 모양이 아니면 null", () => {
    expect(profilePayloadOf({ ijw_student_id: "a", school: " ", grade: null, birth_date: "2012-05-01T00:00:00" })).toEqual({
      ijwId: "a",
      school: null,
      grade: null,
      birthDate: "2012-05-01",
    });
    expect(profilePayloadOf({ ijw_student_id: "a", school: null, grade: null, birth_date: "모름" })!.birthDate).toBeNull();
  });
});
