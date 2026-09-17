import { describe, expect, it } from "vitest";
import { teachingClassIdsInWeek } from "./teacher-classes";

const slot = (id: string, classId: string) => ({ id, classId });

describe("강사 시간표의 반 = 담임 반 ∪ 그 주에 교시 하나라도 맡은 반 (원장 2026-09-17)", () => {
  it("담임이 아니어도 교시 하나를 맡으면 그 반이 선다 — 반의 다른 교시(남의 교시·JJ)도 함께", () => {
    const slots = [slot("s1", "homeroom"), slot("s2", "taught"), slot("s3", "taught"), slot("s4", "other")];
    expect([...teachingClassIdsInWeek(slots, ["homeroom"], ["s2"])].sort()).toEqual(["homeroom", "taught"]);
  });

  it("담임 반이 없는 강사(원어민)도 맡은 교시의 반이 뜬다 — 예전엔 시간표가 통째로 비었다", () => {
    expect([...teachingClassIdsInWeek([slot("s1", "a"), slot("s2", "b")], [], ["s2"])]).toEqual(["b"]);
  });

  it("내 교시 행이 그 주에 그려지지 않으면(끝난·아직 안 시작한 배치) 그 반은 안 선다", () => {
    expect([...teachingClassIdsInWeek([slot("s1", "a")], [], ["old-row"])]).toEqual([]);
  });

  it("담임 반은 그 주에 슬롯이 없어도 목록에 남는다(종전 동작 — 거르는 것은 슬롯 쪽)", () => {
    expect([...teachingClassIdsInWeek([], ["homeroom"], [])]).toEqual(["homeroom"]);
  });
});
