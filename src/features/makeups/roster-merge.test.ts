import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { conductedPairs, foreignClassIds, rosterNativePairs } from "./roster-merge";

const T = "teacher-t", OTHER = "teacher-o";
const row = (studentId: string, classId: string | null, teacherId: string | null, status = "unknown") => ({ studentId, classId, teacherId, status });

describe("맡은 보강 회차의 명단 범위", () => {
  it("내가 맡은 회차의 참여만 남긴다 — 출결 반이 내 반이 아니어도", () => {
    const native = [
      row("a", "class-b", T),           // 남의 반 학생을 내가 맡았다
      row("x", "class-b", OTHER),       // 같은 반이지만 남이 맡았다
      row("y", "class-mine", OTHER),    // 내 반이지만 남이 맡았다(종전 경로가 세운다 — 여기서는 빠진다)
      row("z", "class-c", null),        // 강사 미정(가져온 회차)
    ];
    expect(conductedPairs(native, T)).toEqual([{ studentId: "a", classId: "class-b" }]);
  });

  it("취소된 참여·반 없는 참여·중복은 세우지 않는다", () => {
    const native = [row("a", "class-b", T, "cancelled"), row("b", null, T), row("c", "class-b", T), row("c", "class-b", T, "present")];
    expect(conductedPairs(native, T)).toEqual([{ studentId: "c", classId: "class-b" }]);
  });

  it("강사 축이 비면 아무도 세우지 않는다(강사 미정 회차와 맞아떨어지지 않게)", () => {
    expect(conductedPairs([row("z", "class-c", null), row("q", "class-c", "")], "")).toEqual([]);
  });

  it("다른 강사 뷰는 그 강사 축으로 거른다", () => {
    const native = [row("a", "class-b", T), row("x", "class-b", OTHER)];
    expect(conductedPairs(native, OTHER)).toEqual([{ studentId: "x", classId: "class-b" }]);
  });

  it("이름을 따로 읽을 반은 담당 반이 아닌 것뿐이다", () => {
    const pairs = [{ studentId: "a", classId: "class-b" }, { studentId: "c", classId: "class-b" }, { studentId: "d", classId: "class-mine" }];
    expect(foreignClassIds(pairs, new Set(["class-mine"]))).toEqual(["class-b"]);
    expect(foreignClassIds([], new Set(["class-mine"]))).toEqual([]);
  });

  it("명단에 서는 것 = 내 반의 참여(종전) ∪ 내가 맡은 참여 — 지점 전체 읽기 계정이 지점의 참여를 전부 받아도", () => {
    const native = [
      row("a", "class-b", T),           // 내가 맡은 남의 반 학생 → 선다(foreign)
      row("x", "class-b", OTHER),       // 같은 남의 반, 남이 맡음 → 반 이름을 알아도 서지 않는다
      row("y", "class-mine", OTHER),    // 내 반, 남이 맡음 → 종전대로 선다
      row("m", "class-mine", T),        // 내 반, 내가 맡음 → 선다(foreign 아님)
      row("w", "class-c", OTHER),       // 관계없는 반 → 서지 않는다
      row("k", "class-b", T, "cancelled"),
    ];
    expect(rosterNativePairs(new Set(), native, T, new Set(["class-mine"]))).toEqual([
      { studentId: "a", classId: "class-b", foreign: true },
      { studentId: "y", classId: "class-mine", foreign: false },
      { studentId: "m", classId: "class-mine", foreign: false },
    ]);
  });

  it("담당 반이 하나도 없는 강사도 맡은 학생은 선다 — 반의 다른 학생은 서지 않는다", () => {
    const native = [row("a", "class-b", T), row("x", "class-b", OTHER)];
    expect(rosterNativePairs(new Set(), native, T, new Set())).toEqual([{ studentId: "a", classId: "class-b", foreign: true }]);
  });

  it("이미 출결·예약으로 선 학생은 다시 세우지 않는다", () => {
    const native = [row("y", "class-mine", OTHER), row("a", "class-b", T)];
    expect(rosterNativePairs(new Set(["y|class-mine"]), native, T, new Set(["class-mine"]))).toEqual([{ studentId: "a", classId: "class-b", foreign: true }]);
  });
});

describe("명단 배선 — 맡은 보강은 그 학생만 세우고, 저장 관문은 넓히지 않는다", () => {
  const read = (path: string) => readFileSync(join(__dirname, "..", "..", "..", path), "utf8");
  const roster = read("src/features/onescreen/server/roster.ts");

  it("빈 명단 반환 두 곳이 맡은 보강을 먼저 본다", () => {
    expect(roster).toContain("rosterNativePairs(alreadyMakeup, participantsOrLegacy(nativeOutcome), teacherId, ownClassIds)");
    expect(roster.split("conducted.length === 0").length - 1).toBe(2);
    expect(roster.indexOf("const nativeOutcome = await nativePromise")).toBeLessThan(roster.indexOf("conducted.length === 0"));
  });

  it("남의 반은 조회 전용 사전에만 둔다 — 담당 반·오늘의 반 목록에 넣지 않는다", () => {
    expect(roster).not.toMatch(/allClasses\.push\(|activeIds\.push\(|allIds\.push\(/);
    expect(roster).not.toMatch(/const (allClasses|activeIds|allIds|activeClasses) = [^;]*foreign/);
    expect(roster).toContain("const foreignById = new Map(foreignClasses.map((c) => [c.id, c]))");
  });

  it("못 읽은 날은 빈 명단에 알림을 싣는다(조용한 빈 화면 없음)", () => {
    expect(roster).toContain("nativeUnread ? { ...config, makeupNotice: MAKEUP_UNREAD_NOTICE } : config");
    expect(roster.split("emptyConfig").length - 1).toBeGreaterThanOrEqual(3);
  });

  it("출결 칸 쓰기 관문은 종전 그대로다 — 담당 반 확인이 보강 참여 확인보다 먼저다", () => {
    const actions = read("src/features/attendance/server/actions.ts");
    const classGate = actions.indexOf('if (!teaching.has(classId)) return { error: "담당 반이 아닙니다" };');
    expect(classGate).toBeGreaterThan(-1);
    expect(classGate).toBeLessThan(actions.indexOf("nativeWriteAllowance({ studentId, classId, sessionDate })"));
  });
});
