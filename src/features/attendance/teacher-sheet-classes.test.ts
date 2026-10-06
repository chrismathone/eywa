import { describe, expect, it } from "vitest";
import { buildHomeroomHistoryIndex, buildHomeroomSinceIndex, type TeacherTransition } from "@/features/classes/teacher-as-of";
import { classTaughtBy, teacherSheetClasses, type SheetClassAxis } from "./teacher-sheet-classes";

const SEP = { from: "2026-09-01", to: "2026-09-30" };
const OCT = { from: "2026-10-01", to: "2026-10-31" };

/** 인수인계 기록 → 화면이 받는 두 인덱스(담임 이력 · 담임 시작일). 실제 조회와 같은 순수 빌더를 지난다. */
function indexes(transitions: TeacherTransition[]) {
  return { history: buildHomeroomHistoryIndex(transitions), since: buildHomeroomSinceIndex(transitions, "2025-10-01") };
}
const move = (classId: string, date: string, teacherId: string, previousTeacherId: string | null = null): TeacherTransition => ({
  classId, date, teacherName: teacherId, teacherId, previousTeacherId,
});
function cls(id: string, teacherId: string | null, over: Partial<SheetClassAxis> = {}): SheetClassAxis {
  return { id, teacherId, slotTeachers: [], ...over };
}
const ids = (r: { classes: SheetClassAxis[] }) => r.classes.map((c) => c.id);

describe("강사 전체 보기의 반 목록 — 화면·프리랜서 명세서 공용(원장 2026-10-06)", () => {
  it("가르치는 반 = 담임 ∪ 그 기간 교시 담당 ∪ 그 기간의 이전 담임 — 남의 반은 안 들어온다", () => {
    expect(classTaughtBy(cls("a", "T"), "T")).toBe(true);
    expect(classTaughtBy(cls("b", "X", { slotTeachers: [{ id: "T" }] }), "T")).toBe(true);
    expect(classTaughtBy(cls("c", "X", { historicalTeachers: [{ id: "T" }] }), "T")).toBe(true);
    expect(classTaughtBy(cls("d", "X"), "T")).toBe(false);
  });

  it("🔴 그 달이 끝난 뒤에 담임이 된 반은 뺀다 — 실측 이수진: 10/6에 받은 두 반은 9월 표에 없고 10월엔 선다", () => {
    const { history, since } = indexes([move("JJ1I", "2026-09-01", "주연"), move("JJ1I", "2026-10-06", "수진", "주연")]);
    const classes = [cls("JJ1I", "수진", { homeroomHistory: history.get("JJ1I") }), cls("MS1A", "수진")];
    const sep = teacherSheetClasses({ classes, teacherId: "수진", window: SEP, sinceIdx: since });
    expect(ids(sep)).toEqual(["MS1A"]);
    // 거르기 전 목록·역할·시작일은 그대로 준다(화면이 표에 없는 반을 따로 다룬다).
    expect(sep.taught.map((c) => c.id)).toEqual(["JJ1I", "MS1A"]);
    expect(sep.roles.get("JJ1I")).toBe("homeroom");
    expect(sep.sinceByClass.get("JJ1I")).toBe("2026-10-06");
    expect(ids(teacherSheetClasses({ classes, teacherId: "수진", window: OCT, sinceIdx: since }))).toEqual(["JJ1I", "MS1A"]);
  });

  it("그 달의 이전 담임 표에는 그대로 선다 — 넘겨준 사람의 9월은 사라지지 않는다", () => {
    const { history, since } = indexes([move("JJ1I", "2026-09-01", "주연"), move("JJ1I", "2026-10-06", "수진", "주연")]);
    const classes = [cls("JJ1I", "수진", { homeroomHistory: history.get("JJ1I"), historicalTeachers: [{ id: "주연" }] })];
    const r = teacherSheetClasses({ classes, teacherId: "주연", window: SEP, sinceIdx: since });
    expect(ids(r)).toEqual(["JJ1I"]);
    // 이전 담임으로만 잡힌 반은 역할이 없고 시작일도 주지 않는다(칸은 담임 이력이 가른다).
    expect(r.roles.get("JJ1I")).toBeNull();
    expect(r.sinceByClass.get("JJ1I")).toBeNull();
  });

  it("🔴 맡았다 넘겼다 다시 맡은 사람(A → B → A)은 앞 구간이 그 달에 걸리면 빼지 않는다", () => {
    const { history, since } = indexes([
      move("C", "2026-08-01", "A"),
      move("C", "2026-09-20", "B", "A"),
      move("C", "2026-10-06", "A", "B"),
    ]);
    const classes = [cls("C", "A", { homeroomHistory: history.get("C") })];
    // 지금 구간의 시작일은 10/6이지만 9/1~9/19에 담임이었다.
    expect(since.byClassTeacher.get("C|A")).toBe("2026-10-06");
    expect(ids(teacherSheetClasses({ classes, teacherId: "A", window: SEP, sinceIdx: since }))).toEqual(["C"]);
  });

  it("🔴 교시 담당·겸임 반은 담임 시작일이 늦어도 빼지 않는다 — 그 사람이 실제로 그 교시를 가르쳤다", () => {
    const { since } = indexes([move("E", "2026-10-06", "T", "X")]);
    const slotAndHome = teacherSheetClasses({ classes: [cls("E", "T", { slotTeachers: [{ id: "T" }] })], teacherId: "T", window: SEP, sinceIdx: since });
    expect(slotAndHome.roles.get("E")).toBe("both");
    expect(ids(slotAndHome)).toEqual(["E"]);
    const slotOnly = teacherSheetClasses({ classes: [cls("E", "X", { slotTeachers: [{ id: "T" }] })], teacherId: "T", window: SEP, sinceIdx: since });
    expect(ids(slotOnly)).toEqual(["E"]);
  });

  it("🔴 근거가 없으면 빼지 않는다 — 인수인계 기록 없음 · 인덱스를 안 받음 · 기록의 마지막 담임이 지금 담임과 다름", () => {
    const classes = [cls("C", "T")];
    expect(ids(teacherSheetClasses({ classes, teacherId: "T", window: SEP, sinceIdx: buildHomeroomSinceIndex([], "2025-10-01") }))).toEqual(["C"]);
    expect(ids(teacherSheetClasses({ classes, teacherId: "T", window: SEP, sinceIdx: null }))).toEqual(["C"]);
    // 기록의 마지막 사람이 남이면(기록 없이 담임이 바뀜) 시작일을 지어내지 않는다.
    const { since } = indexes([move("C", "2026-10-06", "남", "T")]);
    expect(ids(teacherSheetClasses({ classes, teacherId: "T", window: SEP, sinceIdx: since }))).toEqual(["C"]);
  });

  it("강사를 안 고르면 빈 목록 · 그 달 말일에 담임이 된 반은 그 달 표에 선다", () => {
    expect(teacherSheetClasses({ classes: [cls("C", "T")], teacherId: null, window: SEP, sinceIdx: null })).toEqual({
      taught: [], roles: new Map(), sinceByClass: new Map(), classes: [], handovers: [],
    });
    const { since } = indexes([move("C", "2026-09-30", "T", "X")]);
    expect(ids(teacherSheetClasses({ classes: [cls("C", "T")], teacherId: "T", window: SEP, sinceIdx: since }))).toEqual(["C"]);
  });
});

describe("담임이 바뀐 반 표식(handovers) — 프리랜서 명세서 '발행 전 확인' 재료", () => {
  it("기간 도중에 넘겨받은 반 = took(그날부터) · 기간 첫날부터 담임이면 표식 없음", () => {
    const { history, since } = indexes([move("MID", "2026-09-10", "T", "X"), move("FULL", "2026-09-01", "T", "X")]);
    const classes = [cls("MID", "T", { homeroomHistory: history.get("MID") }), cls("FULL", "T", { homeroomHistory: history.get("FULL") }), cls("OLD", "T")];
    const r = teacherSheetClasses({ classes, teacherId: "T", window: SEP, sinceIdx: since });
    expect(r.handovers).toEqual([{ classId: "MID", kind: "took", since: "2026-09-10" }]);
  });

  it("기간에 담임이었지만 지금은 아닌 반 = gave — 기간 도중에 넘겼든 그 달 뒤에 넘겼든", () => {
    const { history, since } = indexes([
      move("DURING", "2026-08-01", "T"), move("DURING", "2026-09-20", "N", "T"),
      move("AFTER", "2026-08-01", "T"), move("AFTER", "2026-10-06", "N", "T"),
    ]);
    const classes = [
      cls("DURING", "N", { homeroomHistory: history.get("DURING"), historicalTeachers: [{ id: "T" }] }),
      cls("AFTER", "N", { homeroomHistory: history.get("AFTER"), historicalTeachers: [{ id: "T" }] }),
    ];
    const r = teacherSheetClasses({ classes, teacherId: "T", window: SEP, sinceIdx: since });
    expect(r.handovers).toEqual([
      { classId: "DURING", kind: "gave", since: null },
      { classId: "AFTER", kind: "gave", since: null },
    ]);
  });

  it("🔴 겸임 반(담임이면서 교시도 맡는다)도 기간 도중에 담임이 됐으면 took — 담임 시작일은 안 주지만 담임 몫 칸은 그날부터다", () => {
    const { history, since } = indexes([move("BOTH", "2026-09-10", "T", "X")]);
    const classes = [cls("BOTH", "T", { slotTeachers: [{ id: "T" }], homeroomHistory: history.get("BOTH") })];
    const r = teacherSheetClasses({ classes, teacherId: "T", window: SEP, sinceIdx: since });
    expect(r.roles.get("BOTH")).toBe("both");
    expect(r.sinceByClass.get("BOTH")).toBeNull();
    expect(r.handovers).toEqual([{ classId: "BOTH", kind: "took", since: "2026-09-10" }]);
  });

  it("🔴 맡았다 넘겼다 다시 맡은 반(A → B → A) — 그 달엔 '넘긴 반'이다(다음 달의 재시작일을 took으로 적지 않는다)", () => {
    const { history, since } = indexes([move("C", "2026-08-01", "A"), move("C", "2026-09-20", "B", "A"), move("C", "2026-10-06", "A", "B")]);
    const classes = [cls("C", "A", { homeroomHistory: history.get("C") })];
    expect(teacherSheetClasses({ classes, teacherId: "A", window: SEP, sinceIdx: since }).handovers).toEqual([{ classId: "C", kind: "gave", since: null }]);
    // 10월엔 도중에 다시 받은 반이다.
    expect(teacherSheetClasses({ classes, teacherId: "A", window: OCT, sinceIdx: since }).handovers).toEqual([{ classId: "C", kind: "took", since: "2026-10-06" }]);
  });

  it("받았다가 같은 달에 넘긴 반은 한 줄(took)만 — 반 수를 두 번 세지 않는다", () => {
    const { history, since } = indexes([move("C", "2026-08-01", "X"), move("C", "2026-09-05", "T", "X"), move("C", "2026-09-20", "N", "T")]);
    const classes = [cls("C", "N", { homeroomHistory: history.get("C"), historicalTeachers: [{ id: "T" }] })];
    expect(teacherSheetClasses({ classes, teacherId: "T", window: SEP, sinceIdx: since }).handovers).toEqual([{ classId: "C", kind: "took", since: "2026-09-05" }]);
  });

  it("표에서 빠진 반(그 달 뒤에 담임이 된 반)·교시 담당 반·기록 없는 반은 표식이 없다", () => {
    const { history, since } = indexes([move("LATER", "2026-09-01", "X"), move("LATER", "2026-10-06", "T", "X")]);
    const classes = [
      cls("LATER", "T", { homeroomHistory: history.get("LATER") }),
      cls("SLOT", "X", { slotTeachers: [{ id: "T" }] }),
      cls("PLAIN", "T"),
    ];
    const r = teacherSheetClasses({ classes, teacherId: "T", window: SEP, sinceIdx: since });
    expect(ids(r)).toEqual(["SLOT", "PLAIN"]);
    expect(r.handovers).toEqual([]);
  });
});
