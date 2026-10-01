import { describe, expect, it } from "vitest";
import { buildTeacherMappings } from "./teacher-mappings";
import { parseTeacherGrid } from "../structure/parse-grid";
import { fixture } from "./test-fixture";

describe("강사 머리글 자동 해결", () => {
  it("영문 별칭이 달라도 한글 이름이 유일하면 활성 계정으로 연결한다", () => {
    const f = fixture();
    f.grids.teacher.cells[1]![1] = "Jennifer 육소희 605";
    const blocks = parseTeacherGrid(f.grids.teacher).teachers;
    expect(buildTeacherMappings(blocks, f.ctx.teachers)[0]).toMatchObject({
      teacherId: "t1",
      method: "header",
    });
    expect(
      buildTeacherMappings(blocks, f.ctx.teachers, { Jennifer: "" })[0],
    ).toMatchObject({ teacherId: null, method: "manual" });
  });
  it("한글 이름 중복과 영문/한글 계정 불일치는 수동 연결한다", () => {
    const f = fixture();
    const blocks = parseTeacherGrid(f.grids.teacher).teachers;
    const duplicate = { ...f.ctx.teachers[0]!, id: "t2", englishName: "Other" };
    expect(
      buildTeacherMappings(blocks, [...f.ctx.teachers, duplicate])[0]!
        .teacherId,
    ).toBeNull();
    f.ctx.teachers[0]!.displayName = "다른강사";
    expect(
      buildTeacherMappings(blocks, [...f.ctx.teachers, duplicate])[0]!
        .teacherId,
    ).toBeNull();
    expect(
      buildTeacherMappings(blocks, [...f.ctx.teachers, duplicate], {
        Anna: "t2",
      })[0]!.teacherId,
    ).toBe("t2");
  });
  it("같은 영문 머리글에 서로 다른 한글 담당자가 있으면 첫 번째를 임의 채택하지 않는다", () => {
    const f = fixture();
    const blocks = parseTeacherGrid(f.grids.teacher).teachers;
    const second = { ...blocks[0]!, header: "Anna 다른강사 604" };
    const teachers = [
      ...f.ctx.teachers,
      {
        ...f.ctx.teachers[0]!,
        id: "t2",
        displayName: "다른강사",
        englishName: null,
      },
    ];
    expect(
      buildTeacherMappings([...blocks, second], teachers)[0]!.teacherId,
    ).toBeNull();
  });
});
