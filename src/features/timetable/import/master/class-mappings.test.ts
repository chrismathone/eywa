import { describe, expect, it } from "vitest";
import { buildClassMappings } from "./class-mappings";
import type { MasterClass, MasterEnrollment } from "./types";

const klass = (id: string, className: string, track = "eie"): MasterClass => ({
  id,
  className,
  track,
  active: true,
  closedAt: null,
  subject: "english",
  teacherId: null,
  classroomId: null,
});
const members = (classId: string, ids: string[]): MasterEnrollment[] =>
  ids.map((studentId) => ({
    id: `${classId}:${studentId}`,
    studentId,
    classId,
    startDate: "2026-09-01",
    endDate: null,
    onHold: false,
    isTransferred: false,
    attendanceDays: null,
  }));
function map(
  classes: MasterClass[],
  current: MasterEnrollment[],
  sheet: Record<string, string[]>,
  bindings = {},
  counts?: Map<string, number>,
) {
  return buildClassMappings(
    Object.keys(sheet),
    classes,
    current,
    new Map(Object.entries(sheet)),
    counts ??
      new Map(Object.entries(sheet).map(([name, ids]) => [name, ids.length])),
    bindings,
  );
}
describe("EiE 자동 매핑과 수동 우선", () => {
  it("계열을 넘는 진급도 명단으로 연결하고 이미 존재하는 다음 반 이름의 연쇄를 처리한다", () => {
    const result = map(
      [klass("ls", "LS6"), klass("le", "LE1")],
      [...members("ls", ["1", "2"]), ...members("le", ["3", "4"])],
      { LE1: ["1", "2"], LE2: ["3", "4"] },
    );
    expect(result.map((m) => [m.classId, m.method])).toEqual([
      ["ls", "roster"],
      ["le", "roster"],
    ]);
  });
  it("양쪽 명단 과반수면 일부 신규 학생이 섞여도 자동 연결한다", () => {
    const result = map(
      [klass("c", "JP3")],
      members("c", ["1", "2", "3", "4", "old"]),
      { JP4: ["1", "2", "3", "4", "new"] },
    );
    expect(result[0]).toMatchObject({
      classId: "c",
      method: "roster",
      manualReason: null,
    });
  });
  it("같은 이름의 반이 있어도 명단 후보가 동점이면 수동 연결한다", () => {
    const result = map(
      [klass("a", "PL2"), klass("b", "PL1")],
      [...members("a", ["1", "2"]), ...members("b", ["1", "2"])],
      { PL2: ["1", "2"] },
    );
    expect(result[0]).toMatchObject({
      classId: null,
      method: "unmapped",
      manualReason: expect.stringContaining("여러 개"),
    });
  });
  it("수동 선택과 명시적 연결 해제는 자동 매핑이 덮지 않는다", () => {
    const classes = [klass("a", "PL1"), klass("b", "PL3")];
    const current = members("a", ["1", "2"]);
    expect(
      map(classes, current, { PL2: ["1", "2"] }, { PL2: "b" })[0],
    ).toMatchObject({ classId: "b", method: "manual" });
    expect(
      map(classes, current, { PL2: ["1", "2"] }, { PL2: "" })[0],
    ).toMatchObject({ classId: null, method: "manual" });
  });
  it("분반으로 한 기존 반을 두 반이 차지하면 자동 연결하지 않는다", () => {
    const result = map([klass("a", "PL1")], members("a", ["1", "2", "3"]), {
      PL2a: ["1", "2"],
      PL2b: ["2", "3"],
    });
    expect(
      result.every((m) => !m.classId && m.manualReason?.includes("겹쳐")),
    ).toBe(true);
  });
  it("수동 반과 충돌하는 자동 후보도 수동 수정 대상으로 돌린다", () => {
    const result = map(
      [klass("a", "PL1")],
      members("a", ["1", "2"]),
      { PL2a: ["1", "2"], PL2b: ["1", "2"] },
      { PL2a: "a" },
    );
    expect(result.map((m) => m.classId)).toEqual(["a", null]);
  });
  it("일부 학생만 빠져나온 큰 반이나 미확정 명단은 진급으로 추정하지 않는다", () => {
    const classes = [klass("a", "PL1")];
    expect(
      map(classes, members("a", ["1", "2", "3", "4"]), { PL2: ["1", "2"] })[0]!
        .classId,
    ).toBeNull();
    expect(
      map(
        classes,
        members("a", ["1", "2"]),
        { PL2: ["1", "2"] },
        {},
        new Map([["PL2", 3]]),
      )[0]!.classId,
    ).toBeNull();
  });
  it("이름 모양이 EiE여도 DB의 프로그램이 다르면 자동 진급하지 않는다", () => {
    const result = map(
      [klass("a", "PL1", "injaewon")],
      members("a", ["1", "2"]),
      { PL2: ["1", "2"] },
    );
    expect(result[0]).toMatchObject({ classId: null, suggestedId: "a" });
  });
  it("여러 인재원 반을 병행하는 학생은 기존 동명 반 연결 규칙을 유지한다", () => {
    const result = map(
      [klass("a", "브릿지 C", "injaewon"), klass("b", "다른 수업", "injaewon")],
      [...members("a", ["1", "2"]), ...members("b", ["1", "2"])],
      { "브릿지 C": ["1", "2"] },
    );
    expect(result[0]).toMatchObject({
      classId: "a",
      method: "name",
      manualReason: null,
    });
  });
});
