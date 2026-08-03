/**
 * 작성률 귀속 이동(0173a 임시 위임) — 순수 규칙 고정.
 *
 * 틀리면 **결근한 담임이 0%로 빨갛게 남거나**(안 옮겨짐) **엉뚱한 사람이 남의 미작성을 뒤집어쓴다**(잘못 옮겨짐).
 * 둘 다 화면만 봐선 원인을 못 찾는 종류라 경계를 여기서 못박는다.
 */
import { describe, expect, it } from "vitest";
import { buildDelegateAttribution } from "./writing-rate-delegation";

const D = (classId: string, teacherName: string, fromDate: string, toDate = fromDate) => ({
  classId,
  teacherName,
  fromDate,
  toDate,
});

describe("buildDelegateAttribution", () => {
  it("위임된 날에는 대체 강사를, 그 밖의 날에는 null을 돌려준다", () => {
    const at = buildDelegateAttribution([D("c1", "이수진", "2026-08-04")]);
    expect(at("c1", "2026-08-04")).toBe("이수진");
    expect(at("c1", "2026-08-03")).toBeNull(); // 하루 전
    expect(at("c1", "2026-08-05")).toBeNull(); // 하루 뒤
  });

  it("여러 날 위임은 양끝 포함 전 구간에 적용된다", () => {
    const at = buildDelegateAttribution([D("c1", "이수진", "2026-08-04", "2026-08-06")]);
    for (const d of ["2026-08-04", "2026-08-05", "2026-08-06"]) expect(at("c1", d)).toBe("이수진");
    expect(at("c1", "2026-08-07")).toBeNull();
  });

  it("위임 안 된 반은 건드리지 않는다 — 담임 귀속이 그대로 남아야 한다", () => {
    const at = buildDelegateAttribution([D("c1", "이수진", "2026-08-04")]);
    expect(at("c2", "2026-08-04")).toBeNull();
  });

  it("표시명이 없는 대체 강사는 귀속하지 않는다(fail-safe: 담임에게 남는다)", () => {
    // 축이 이름 문자열이라 이름이 없으면 작성 기록과 맞물릴 수 없다 → 옮기면 미작성이 조용히 증발한다.
    const at = buildDelegateAttribution([D("c1", "", "2026-08-04")]);
    expect(at("c1", "2026-08-04")).toBeNull();
  });

  it("같은 반·같은 날에 위임이 겹치면 결정적으로 고른다(새로고침마다 바뀌면 안 된다)", () => {
    const rows = [D("c1", "박강사", "2026-08-04"), D("c1", "김강사", "2026-08-04")];
    const a = buildDelegateAttribution(rows)("c1", "2026-08-04");
    const b = buildDelegateAttribution([...rows].reverse())("c1", "2026-08-04");
    expect(a).toBe(b);
    expect(a).toBe("김강사"); // 시작일 같으면 이름순
  });

  it("시작일이 다르면 먼저 시작한 위임이 이긴다", () => {
    const at = buildDelegateAttribution([
      D("c1", "박강사", "2026-08-04", "2026-08-06"),
      D("c1", "김강사", "2026-08-05", "2026-08-06"),
    ]);
    expect(at("c1", "2026-08-05")).toBe("박강사");
  });

  it("위임이 하나도 없으면 항상 null(위임 없는 주엔 기존 동작과 완전히 동일)", () => {
    const at = buildDelegateAttribution([]);
    expect(at("c1", "2026-08-04")).toBeNull();
  });

  it("날짜 형식이 깨지면 귀속하지 않는다(fail-closed — 남의 분모를 옮기는 판정이다)", () => {
    const at = buildDelegateAttribution([D("c1", "이수진", "2026-8-4")]);
    expect(at("c1", "2026-08-04")).toBeNull();
  });
});
