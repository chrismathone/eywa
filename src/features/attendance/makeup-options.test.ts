import { describe, expect, it } from "vitest";
import { absenceOptionLabel, buildAbsenceOptions, type AbsenceRow } from "./makeup-options";

/**
 * 결석 후보 — 🔴 핵심은 **반 이동 전 옛 반 결석도 후보에 남는 것**(원장 2026-08-19 "이월 보강").
 * 수강 여부로 거르면 이월 보강 대상이 통째로 사라진다.
 */
const row = (classId: string, className: string, date: string): AbsenceRow => ({ classId, className, date });

describe("buildAbsenceOptions", () => {
  it("🔴 지금 수강 중이 아닌 반(반 이동 전)도 후보에 남고 '이전 반'으로 표시된다", () => {
    const out = buildAbsenceOptions(
      [row("old", "초등M 초4 BS1J", "2026-08-12"), row("new", "초등M 개별 CR1C", "2026-08-14")],
      "2026-08-19",
      new Set(["new"]),
    );
    expect(out.map((o) => o.classId)).toEqual(["new", "old"]); // 최신순
    expect(out.find((o) => o.classId === "old")?.pastClass).toBe(true);
    expect(out.find((o) => o.classId === "new")?.pastClass).toBeUndefined();
  });

  it("같은 반·같은 날 여러 교시 행은 한 줄로 접는다(실측 하루 3행)", () => {
    const out = buildAbsenceOptions(
      [row("c1", "수학", "2026-08-12"), row("c1", "수학", "2026-08-12"), row("c1", "수학", "2026-08-12")],
      "2026-08-19",
    );
    expect(out).toHaveLength(1);
  });

  it("🔴 보강한 날은 후보가 아니다(출석부가 한 칸이라 결석과 보강이 만날 수 없다)", () => {
    const out = buildAbsenceOptions([row("c1", "수학", "2026-08-19")], "2026-08-19");
    expect(out).toEqual([]);
  });

  it("반 이름이 비어도 빈 칸을 만들지 않는다", () => {
    const out = buildAbsenceOptions([{ classId: "c1", className: null, date: "2026-08-12" }], "2026-08-19");
    expect(out[0]!.className).toBe("(반 이름 없음)");
  });

  it("같은 날 여러 반이면 반 이름 순으로 안정 정렬(순서가 흔들리면 잘못 고른다)", () => {
    const out = buildAbsenceOptions(
      [row("b", "나반", "2026-08-12"), row("a", "가반", "2026-08-12")],
      "2026-08-19",
    );
    expect(out.map((o) => o.className)).toEqual(["가반", "나반"]);
  });

  it("반 id·날짜가 비면 버린다(고를 수 없는 후보를 만들지 않는다)", () => {
    const out = buildAbsenceOptions([{ classId: "", className: "수학", date: "2026-08-12" }], "2026-08-19");
    expect(out).toEqual([]);
  });
});

describe("absenceOptionLabel", () => {
  it("월/일 + 반 이름, 이전 반이면 꼬리표", () => {
    expect(absenceOptionLabel({ classId: "c", className: "초4 BS1J", date: "2026-08-05" })).toBe(
      "8/5 초4 BS1J",
    );
    expect(
      absenceOptionLabel({ classId: "c", className: "초4 BS1J", date: "2026-08-05", pastClass: true }),
    ).toBe("8/5 초4 BS1J (이전 반)");
  });
});

describe("교시 — 하루 여러 교시를 도는 반(JJ실·영어)에서 어느 수업의 결석인지", () => {
  it("같은 (반,날짜)의 교시별 행을 접으면서 교시를 모은다", () => {
    const out = buildAbsenceOptions(
      [
        { classId: "c1", className: "중1 정규A", date: "2026-08-12", slotStart: "17:20:00" },
        { classId: "c1", className: "중1 정규A", date: "2026-08-12", slotStart: "16:20:00" },
      ],
      "2026-08-19",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.slots).toEqual(["16:20", "17:20"]);
  });

  it("🔴 보강 메모가 **뒤 행**에만 있어도 '보강 완료'로 본다(첫 행만 보면 놓친다)", () => {
    const out = buildAbsenceOptions(
      [
        { classId: "c1", className: "중1 정규A", date: "2026-08-12", slotStart: "16:20", note: null },
        { classId: "c1", className: "중1 정규A", date: "2026-08-12", slotStart: "17:20", note: "8/19 보강 예정" },
      ],
      "2026-08-20",
    );
    expect(out[0]!.alreadyMadeUp).toBe(true);
  });

  it("하루 단위로 찍힌 결석(교시 없음)은 교시를 지어내지 않는다", () => {
    const out = buildAbsenceOptions(
      [{ classId: "c1", className: "초4 BS1J", date: "2026-08-12", slotStart: null }],
      "2026-08-19",
    );
    expect(out[0]!.slots).toBeUndefined();
  });

  it("라벨에 교시가 붙는다 — 시각 그대로(교시 이름으로 옮기지 않는다, #106)", () => {
    expect(
      absenceOptionLabel({
        classId: "c",
        className: "중1 정규A",
        date: "2026-08-12",
        slots: ["16:20", "17:20"],
      }),
    ).toBe("8/12 중1 정규A 16:20·17:20");
    expect(
      absenceOptionLabel({
        classId: "c",
        className: "중1 정규A",
        date: "2026-08-12",
        slots: ["16:20"],
        pastClass: true,
      }),
    ).toBe("8/12 중1 정규A 16:20 (이전 반)");
  });
});
