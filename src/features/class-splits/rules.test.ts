import { describe, expect, it } from "vitest";
import { intersectWindows, maxUnitsFrom, splitUnitMinutes, startOptions, toMin, durationLabel } from "./rules";
import { hasDayInRange, periodText, resolvePeriod, splitActiveOn, splitsCollide } from "./period";
import { splitLinesForCell, uniqueSplits } from "./lines";
import { canSplitClass, CLASS_SPLITTER_USER_IDS } from "./access";
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

describe("고를 수 있는 시작 시각 = 두 반이 같이 도는 구간 안", () => {
  it("이성우 3시간(교시마다 행) × 유형숙 1시간 → 17:20 한 자리", () => {
    const source = [w("16:20", "17:20"), w("17:20", "18:20"), w("18:20", "19:20")];
    const target = [w("17:20", "18:20")];
    const both = intersectWindows(source, target);
    expect(both).toEqual([w("17:20", "18:20")]);
    expect(startOptions(both, 60)).toEqual([toMin("17:20")]);
    expect(maxUnitsFrom(both, toMin("17:20"), 60)).toBe(1);
  });
  it("같은 3시간끼리면 16:20·17:20·18:20, 앞에서 고르면 최대 3시간", () => {
    const both = intersectWindows([w("16:20", "19:20")], [w("16:20", "19:20")]);
    expect(startOptions(both, 60)).toEqual(["16:20", "17:20", "18:20"].map(toMin));
    expect(maxUnitsFrom(both, toMin("16:20"), 60)).toBe(3);
    expect(maxUnitsFrom(both, toMin("18:20"), 60)).toBe(1);
  });
  it("EiE 40분 — 한 단위가 통째로 들어가는 자리만", () => {
    expect(startOptions([w("16:20", "18:00")], 40)).toEqual(["16:20", "17:00"].map(toMin));
  });
  it("안 겹치면 선택지가 없다", () => {
    expect(intersectWindows([w("14:00", "15:00")], [w("16:00", "17:00")])).toEqual([]);
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
  it("시간이 안 겹치는 칸·다른 요일엔 안 선다", () => {
    expect(splitLinesForCell({ classId: "A", dayOfWeek: "tue", startTime: "14:20", endTime: "16:20" }, [split()], names)).toEqual([]);
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

describe("권한 — 명단 + super_admin", () => {
  it("침산은 명단만(master여도 명단 밖이면 불가)", () => {
    expect(canSplitClass({ id: CLASS_SPLITTER_USER_IDS[0]!, systemRole: "master" }, { isSuperAdmin: false, isChinsanTenant: true })).toBe(true);
    expect(canSplitClass({ id: "someone", systemRole: "master" }, { isSuperAdmin: false, isChinsanTenant: true })).toBe(false);
    expect(canSplitClass({ id: "someone", systemRole: "teacher" }, { isSuperAdmin: true, isChinsanTenant: true })).toBe(true);
  });
  it("일반판은 원장만", () => {
    expect(canSplitClass({ id: "x", systemRole: "master" }, { isSuperAdmin: false, isChinsanTenant: false })).toBe(true);
    expect(canSplitClass({ id: "x", systemRole: "admin" }, { isSuperAdmin: false, isChinsanTenant: false })).toBe(false);
  });
});
