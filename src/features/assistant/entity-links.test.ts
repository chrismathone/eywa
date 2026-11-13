import { describe, expect, it } from "vitest";
import { entityHref, inferredEntityLink } from "./entity-links";

const ID = "11111111-1111-4111-8111-111111111111";
describe("보고서 내부 상세 링크", () => {
  it("학생·강사·반은 실제 행 ID로 정해진 내부 경로만 만든다", () => {
    expect(entityHref({ entity: "student", idColumn: "student_id" }, { student_id: ID })).toBe(`/students/${ID}`);
    expect(entityHref({ entity: "staff", idColumn: "teacher_id" }, { teacher_id: ID })).toBe(`/staff/${ID}`);
    expect(entityHref({ entity: "class", idColumn: "class_id" }, { class_id: ID })).toBe(`/classes/${ID}`);
  });
  it("이름·외부 주소·다른 종류의 ID·비어 있는 ID로 링크를 만들지 않는다", () => {
    for (const value of [null, "김민수", "https://example.com", "../login", "javascript:alert(1)"]) expect(entityHref({ entity: "student", idColumn: "student_id" }, { student_id: value })).toBeNull();
    expect(entityHref({ entity: "student", idColumn: "class_id" }, { class_id: ID })).toBeNull();
  });
  it("예전 명단은 명시된 학생 ID가 있을 때만 연결하며 이름만 보고 추정하지 않는다", () => {
    expect(inferredEntityLink("이름", "이름", "수학만 듣는 학생", ["이름", "student_id"])).toEqual({ entity: "student", idColumn: "student_id" });
    expect(inferredEntityLink("이름", "이름", "수학만 듣는 학생", ["이름", "id"])).toBeUndefined();
    expect(inferredEntityLink("이름", "이름", "담당자 현황", ["이름", "student_id"])).toBeUndefined();
    expect(inferredEntityLink("student_status", "상태", "학생 명단", ["student_status", "student_id"])).toBeUndefined();
  });
});
