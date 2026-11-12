import { describe, expect, it } from "vitest";
import { durationLabel, endAfter, intersectWindows, splitBoundaries, splitUnitMinutes, startOptions, toMin } from "./rules";
import { hasDayInRange, periodText, resolvePeriod, splitActiveOn, splitsCollide } from "./period";
import { groupSplitLines, splitLinesForCell, uniqueSplits } from "./lines";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canSplitClass, CLASS_SPLIT_ENABLED } from "./access";
import type { ClassSplit } from "./rules";

const w = (a: string, b: string) => ({ start: toMin(a), end: toMin(b) });

describe("시간 단위 — 수학 1시간 · EiE 40분(원장 2026-10-06)", () => {
  it("한쪽이라도 EiE면 40분", () => {
    expect(splitUnitMinutes([{ subject: "math", englishTrack: null }, { subject: "math", englishTrack: null }])).toBe(60);
    expect(splitUnitMinutes([{ subject: "english", englishTrack: "eie" }, { subject: "english", englishTrack: null }])).toBe(40);
    expect(splitUnitMinutes([{ subject: "english", englishTrack: "ijw" }, { subject: "english", englishTrack: null }])).toBe(60);
  });
  it("길이 표기", () => {
    expect(durationLabel(60)).toBe("1시간");
    expect(durationLabel(120)).toBe("2시간");
    expect(durationLabel(40)).toBe("40분");
    expect(durationLabel(80)).toBe("80분");
  });
});

describe("교시 칸 경계(splitBoundaries)", () => {
  const edgesOf = (...ws: { start: number; end: number }[]) => ws.flatMap((x) => [x.start, x.end]);
  const opts = (source: { start: number; end: number }[], target: { start: number; end: number }[], unit: number) =>
    splitBoundaries(intersectWindows(source, target), edgesOf(...source, ...target), unit);

  it("원장 제보 2026-10-06 — 수학 55분 교시가 한 칸만 겹쳐도 나눌 수 있다(고등M 단체 BS4F → 중등M 중3 BS3Q)", () => {
    const source = [w("20:10", "21:05"), w("21:05", "22:00")];
    const target = [w("18:20", "19:15"), w("19:15", "20:10"), w("20:10", "21:05")];
    const b = opts(source, target, 60);
    expect(startOptions(b)).toEqual([{ start: toMin("20:10"), maxUnits: 1 }]);
    expect(endAfter(b, toMin("20:10"), 1)).toBe(toMin("21:05"));
    expect(durationLabel(55)).toBe("1시간");
  });
  it("교시마다 행인 3교시 × 같은 3교시 → 세 자리, 앞에서 고르면 최대 3칸", () => {
    const rows = [w("18:20", "19:15"), w("19:15", "20:10"), w("20:10", "21:05")];
    const b = opts(rows, rows, 60);
    expect(startOptions(b).map((s) => s.start)).toEqual(["18:20", "19:15", "20:10"].map(toMin));
    expect(startOptions(b)[0]!.maxUnits).toBe(3);
    expect(endAfter(b, toMin("18:20"), 2)).toBe(toMin("20:10"));
  });
  it("3시간 한 줄짜리 행은 명목 단위로 자른다", () => {
    const b = opts([w("16:20", "19:20")], [w("16:20", "19:20")], 60);
    expect(startOptions(b).map((s) => s.start)).toEqual(["16:20", "17:20", "18:20"].map(toMin));
  });
  it("EiE 40분 교시", () => {
    const rows = [w("16:20", "17:00"), w("17:00", "17:40")];
    const b = opts(rows, rows, 40);
    expect(startOptions(b).map((s) => s.start)).toEqual(["16:20", "17:00"].map(toMin));
    expect(durationLabel(80)).toBe("80분");
  });
  it("10~20분 어긋난 겹침·안 겹침은 선택지가 없다", () => {
    expect(opts([w("19:00", "20:00")], [w("19:45", "20:45")], 60)).toEqual([]);
    expect(intersectWindows([w("14:00", "15:00")], [w("16:00", "17:00")])).toEqual([]);
  });
  it("범위를 넘는 길이는 끝이 없다", () => {
    const b = opts([w("20:10", "21:05")], [w("20:10", "21:05")], 60);
    expect(endAfter(b, toMin("20:10"), 2)).toBeNull();
  });
});

describe("기간 — 일별·월별·영구, 과거 소급 금지", () => {
  const today = "2026-10-06";
  it("일별은 그날 하루", () => {
    expect(resolvePeriod({ kind: "day", date: "2026-10-09" }, today)).toEqual({ kind: "day", validFrom: "2026-10-09", validTo: "2026-10-09" });
    expect(resolvePeriod({ kind: "day", date: "2026-10-05" }, today)).toHaveProperty("error");
  });
  it("월별 이번 달은 오늘부터로 당긴다", () => {
    expect(resolvePeriod({ kind: "month", start: "2026-10-01", end: "2026-10-31" }, today)).toEqual({
      kind: "month",
      validFrom: today,
      validTo: "2026-10-31",
    });
    expect(resolvePeriod({ kind: "month", start: "2026-09-01", end: "2026-09-30" }, today)).toHaveProperty("error");
  });
  it("영구는 끝이 없다", () => {
    expect(resolvePeriod({ kind: "forever", from: today }, today)).toEqual({ kind: "forever", validFrom: today, validTo: null });
  });
  it("활성 판정 = 요일 + 기간(양 끝 포함)", () => {
    const s = { dayOfWeek: "fri" as const, validFrom: "2026-10-09", validTo: "2026-10-16" };
    expect(splitActiveOn(s, "2026-10-09")).toBe(true);
    expect(splitActiveOn(s, "2026-10-16")).toBe(true);
    expect(splitActiveOn(s, "2026-10-23")).toBe(false);
    expect(splitActiveOn(s, "2026-10-13")).toBe(false); // 화요일
  });
  it("기간 안에 그 요일이 있어야 한다", () => {
    expect(hasDayInRange("fri", "2026-10-06", "2026-10-08")).toBe(false);
    expect(hasDayInRange("fri", "2026-10-06", "2026-10-09")).toBe(true);
    expect(hasDayInRange("fri", "2026-10-06", null)).toBe(true);
  });
  it("기간 문구", () => {
    expect(periodText({ validFrom: "2026-10-09", validTo: "2026-10-09" })).toBe("10/9 하루");
    expect(periodText({ validFrom: "2026-10-06", validTo: "2026-10-31" })).toBe("10/6~10/31");
    expect(periodText({ validFrom: "2026-10-06", validTo: null })).toBe("10/6부터 계속");
  });
});

const split = (o: Partial<ClassSplit> = {}): ClassSplit => ({
  id: "s1",
  studentId: "stu",
  sourceClassId: "A",
  targetClassId: "B",
  dayOfWeek: "tue",
  startTime: "17:20",
  endTime: "18:20",
  validFrom: "2026-10-06",
  validTo: null,
  periodKind: "forever",
  note: null,
  ...o,
});

describe("같은 시간을 두 번 나누지 않는다", () => {
  it("시간·기간이 겹치면 충돌", () => {
    expect(splitsCollide(split(), split({ startTime: "17:50", endTime: "18:50" }))).toBe(true);
    expect(splitsCollide(split(), split({ startTime: "18:20", endTime: "19:20" }))).toBe(false);
    expect(splitsCollide(split({ validTo: "2026-10-10" }), split({ validFrom: "2026-10-11" }))).toBe(false);
    expect(splitsCollide(split(), split({ dayOfWeek: "fri" }))).toBe(false);
  });
});

describe("시간표 줄 — 원래 반엔 →, 받는 반엔 ←", () => {
  const names = {
    student: () => ({ name: "김민수", grade: "1", school: "경명중" }),
    klass: (id: string) => (id === "A" ? { name: "중1 수학", teacherName: "이성우" } : { name: "중1 개별", teacherName: "유형숙" }),
  };
  it("원래 반 칸", () => {
    const [l] = splitLinesForCell({ classId: "A", dayOfWeek: "tue", startTime: "16:20", endTime: "19:20" }, [split()], names);
    expect(l?.dir).toBe("out");
    expect(l?.otherLabel).toBe("유형숙");
  });
  it("받는 반 칸", () => {
    const [l] = splitLinesForCell({ classId: "B", dayOfWeek: "tue", startTime: "17:20", endTime: "18:20" }, [split()], names);
    expect(l?.dir).toBe("in");
    expect(l?.otherLabel).toBe("이성우");
  });
  it("받는 반은 그 시간 칸에만 · 원래 반은 그날 칸이면 시간이 달라도 선다 · 다른 요일엔 안 선다", () => {
    expect(splitLinesForCell({ classId: "B", dayOfWeek: "tue", startTime: "14:20", endTime: "16:20" }, [split()], names)).toEqual([]);
    // 나눈 시간은 받는 반 시간표 기준이라 원래 반 수업 밖일 수 있다(원장 2026-10-06).
    expect(splitLinesForCell({ classId: "A", dayOfWeek: "tue", startTime: "14:20", endTime: "16:20" }, [split()], names)).toHaveLength(1);
    expect(splitLinesForCell({ classId: "A", dayOfWeek: "fri", startTime: "16:20", endTime: "19:20" }, [split()], names)).toEqual([]);
  });
  it("모르는 반이면 지어내지 않는다", () => {
    expect(splitLinesForCell({ classId: "A", dayOfWeek: "tue", startTime: "16:20", endTime: "19:20" }, [split()], { ...names, klass: () => undefined })).toEqual([]);
  });
  it("병합 칸은 한 번씩만", () => {
    const [l] = splitLinesForCell({ classId: "A", dayOfWeek: "tue", startTime: "16:20", endTime: "19:20" }, [split()], names);
    expect(uniqueSplits([{ splits: [l!] }, { splits: [l!] }])).toHaveLength(1);
  });
});

// 기능이 꺼져 있으면(원장 2026-10-06) 누구도 못 나눈다 — 아래 판정은 켜졌을 때의 규칙(스위치를 주입해 늘 돌린다).
describe("권한 — 원장 역할 + 학원 설정에서 지정한 사람(원장 2026-10-06)", () => {
  // 스위치를 주입해 켜진 규칙을 늘 돌린다(꺼 둔 동안 깨진 것이 다시 켜는 날 한꺼번에 드러나지 않게 — 리뷰 A7).
  it("스위치가 꺼져 있으면(기본값) 누구도 못 나눈다", () => {
    expect(canSplitClass({ id: "x", systemRole: "master" }, { isSuperAdmin: true, splitterIds: ["x"] }, false)).toBe(false);
    expect(canSplitClass({ id: "x", systemRole: "master" }, { isSuperAdmin: true, splitterIds: ["x"] })).toBe(CLASS_SPLIT_ENABLED);
  });
  const policy = { isSuperAdmin: false, splitterIds: ["picked"] };
  it("원장 역할은 지정 없이 연다", () => {
    expect(canSplitClass({ id: "x", systemRole: "master" }, { isSuperAdmin: false, splitterIds: [] }, true)).toBe(true);
  });
  it("그 밖의 역할은 지정된 사람만", () => {
    expect(canSplitClass({ id: "picked", systemRole: "admin" }, policy, true)).toBe(true);
    for (const role of ["admin", "manager", "teacher", "counselor", "accountant", "viewer"] as const) {
      expect(canSplitClass({ id: "someone", systemRole: role }, policy, true)).toBe(false);
    }
    // 저장값이 목록이 아니면(손으로 넣은 값) 지정된 사람이 없는 것으로 본다.
    expect(canSplitClass({ id: "picked", systemRole: "admin" }, { isSuperAdmin: false, splitterIds: "xpickedx" as unknown as string[] }, true)).toBe(false);
  });
  it("운영 계정은 지정 없이 통과", () => {
    expect(canSplitClass({ id: "someone", systemRole: "teacher" }, { isSuperAdmin: true, splitterIds: [] }, true)).toBe(true);
  });
});

describe("권한 — 배선과 기능 스위치", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf-8");
  it("🔴 코드에 계정 명단을 두지 않는다 — 게이트는 학원 설정의 지정값을 읽는다", () => {
    const access = read("src/features/class-splits/access.ts");
    expect(access).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(access).not.toMatch(/_IDS\b/);
    expect(read("src/features/class-splits/server/gate.ts")).toContain("settings.permissions.specialAccess.classSplitterIds");
  });
  it("🔴 서버 게이트가 수업 관리 권한도 함께 본다 — 지정만으로는 수업을 못 고치는 사람이 나눌 수 없다", () => {
    // 시간표는 수업 관리 권한이 있을 때만 나누기 팝업을 세운다. 서버가 지정만 보면 화면에 없는 길이 요청으로 열린다([[#77]]).
    const gate = read("src/features/class-splits/server/gate.ts").replace(/\s+/g, " ");
    expect(gate).toContain('canManageTenant(user.systemRole, "classes")');
    expect(gate).toContain("if (!canManageClasses) return false;");
  });
  it("🔴 꺼져 있으면 운영 계정 · 원장 역할 · 지정된 사람 모두 못 나눈다", () => {
    if (CLASS_SPLIT_ENABLED) return;
    const policy = { isSuperAdmin: true, splitterIds: ["picked"] };
    expect(canSplitClass({ id: "picked", systemRole: "master" }, policy)).toBe(false);
    expect(canSplitClass({ id: "picked", systemRole: "admin" }, policy)).toBe(false);
  });
});

describe("툴바 목록 — 반 전체 나누기는 한 건으로 묶는다", () => {
  const names = {
    student: (id: string) => ({ name: id === "s1" ? "가" : "나", grade: null, school: null }),
    klass: (id: string) => (id === "A" ? { name: "고등M 단체 BS4F", teacherName: "이성우" } : { name: "중등M 중3 BS3Q", teacherName: "유형숙" }),
  };
  it("같은 반→반·요일·시간·기간이면 한 건, 해제는 id 전부", () => {
    const cell = { classId: "A", dayOfWeek: "tue", startTime: "20:10", endTime: "22:00" };
    const lines = splitLinesForCell(cell, [split({ id: "x1", studentId: "s1" }), split({ id: "x2", studentId: "s2" })], names);
    const groups = groupSplitLines(lines);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.splitIds.sort()).toEqual(["x1", "x2"]);
    expect(groups[0]!.hereClassName).toBe("고등M 단체 BS4F");
  });
});
