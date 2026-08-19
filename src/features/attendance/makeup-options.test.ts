import { describe, expect, it } from "vitest";
import {
  absenceOptionLabel,
  buildAbsenceOptions,
  subjectMatchesAnchor,
  type AbsenceRow,
} from "./makeup-options";

/**
 * 결석 후보 — 🔴 핵심은 **반 이동 전 옛 반 결석도 후보에 남는 것**(원장 2026-08-19 "이월 보강").
 * 수강 여부로 거르면 이월 보강 대상이 통째로 사라진다.
 */
const row = (classId: string, className: string, date: string): AbsenceRow => ({ classId, className, date });
/** 목록만 보면 되는 테스트용 — 한 벌에서 options만 꺼낸다(뺀 건수는 아래 과목 필터 절에서 본다). */
const opts = (...args: Parameters<typeof buildAbsenceOptions>) => buildAbsenceOptions(...args).options;

describe("buildAbsenceOptions", () => {
  it("🔴 지금 수강 중이 아닌 반(반 이동 전)도 후보에 남고 '이전 반'으로 표시된다", () => {
    const out = opts(
      [row("old", "초등M 초4 BS1J", "2026-08-12"), row("new", "초등M 개별 CR1C", "2026-08-14")],
      "2026-08-19",
      new Set(["new"]),
    );
    expect(out.map((o) => o.classId)).toEqual(["new", "old"]); // 최신순
    expect(out.find((o) => o.classId === "old")?.pastClass).toBe(true);
    expect(out.find((o) => o.classId === "new")?.pastClass).toBeUndefined();
  });

  it("같은 반·같은 날 여러 교시 행은 한 줄로 접는다(실측 하루 3행)", () => {
    const out = opts(
      [row("c1", "수학", "2026-08-12"), row("c1", "수학", "2026-08-12"), row("c1", "수학", "2026-08-12")],
      "2026-08-19",
    );
    expect(out).toHaveLength(1);
  });

  it("🔴 보강한 날은 후보가 아니다(출석부가 한 칸이라 결석과 보강이 만날 수 없다)", () => {
    const out = opts([row("c1", "수학", "2026-08-19")], "2026-08-19");
    expect(out).toEqual([]);
  });

  it("반 이름이 비어도 빈 칸을 만들지 않는다", () => {
    const out = opts([{ classId: "c1", className: null, date: "2026-08-12" }], "2026-08-19");
    expect(out[0]!.className).toBe("(반 이름 없음)");
  });

  it("같은 날 여러 반이면 반 이름 순으로 안정 정렬(순서가 흔들리면 잘못 고른다)", () => {
    const out = opts(
      [row("b", "나반", "2026-08-12"), row("a", "가반", "2026-08-12")],
      "2026-08-19",
    );
    expect(out.map((o) => o.className)).toEqual(["가반", "나반"]);
  });

  it("반 id·날짜가 비면 버린다(고를 수 없는 후보를 만들지 않는다)", () => {
    const out = opts([{ classId: "", className: "수학", date: "2026-08-12" }], "2026-08-19");
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
    const out = opts(
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
    const out = opts(
      [
        { classId: "c1", className: "중1 정규A", date: "2026-08-12", slotStart: "16:20", note: null },
        { classId: "c1", className: "중1 정규A", date: "2026-08-12", slotStart: "17:20", note: "8/19 보강 예정" },
      ],
      "2026-08-20",
    );
    expect(out[0]!.alreadyMadeUp).toBe(true);
  });

  it("하루 단위로 찍힌 결석(교시 없음)은 교시를 지어내지 않는다", () => {
    const out = opts(
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

/**
 * 🔴 **과목 필터** — 수학 반 보강에 영어 결석이 후보로 뜨던 것(원장 제보 2026-08-19). 잘못 고르면
 * 영어 결석 칸에 메모가 간다. 규칙은 **비대칭**이다: 후보가 사라지면 보강을 못 넣는데 화면엔
 * "결석이 없다"로만 보여 원인을 못 찾으므로, 모르는 것은 전부 통과시킨다.
 */
describe("과목 필터 — 앵커 반 과목과 맞는 결석만", () => {
  const mathRow: AbsenceRow = { classId: "m1", className: "초4 BS1J", date: "2026-08-12", subject: "math" };
  const engRow: AbsenceRow = { classId: "e1", className: "초4 DP2", date: "2026-08-13", subject: "english" };

  it("같은 과목만 남고, 뺀 건수를 함께 돌려준다", () => {
    const out = buildAbsenceOptions([mathRow, engRow], "2026-08-19", new Set(), "math");
    expect(out.options.map((o) => o.classId)).toEqual(["m1"]);
    expect(out.hiddenBySubject).toBe(1);
  });

  it("🔴 앵커 과목을 모르면(null·빈 문자열) 아무것도 안 거른다", () => {
    for (const anchor of [null, undefined, "", "  "]) {
      const out = buildAbsenceOptions([mathRow, engRow], "2026-08-19", new Set(), anchor);
      expect(out.options).toHaveLength(2);
      expect(out.hiddenBySubject).toBe(0);
    }
  });

  it("🔴 반의 과목이 비어 있는(미분류) 결석은 **항상 통과**한다 — 통째로 사라지면 '결석이 없다'는 거짓이 된다", () => {
    const unknown: AbsenceRow = { classId: "u1", className: "미분류 반", date: "2026-08-14", subject: null };
    const blank: AbsenceRow = { classId: "u2", className: "빈 과목 반", date: "2026-08-15", subject: "" };
    const out = buildAbsenceOptions([mathRow, engRow, unknown, blank], "2026-08-19", new Set(), "math");
    expect(out.options.map((o) => o.classId).sort()).toEqual(["m1", "u1", "u2"]);
    expect(out.hiddenBySubject).toBe(1);
  });

  it("🔴 반을 옮긴 학생의 **같은 과목** 옛 반 결석은 그대로 남는다(이월 보강이 죽으면 안 된다)", () => {
    const oldMath: AbsenceRow = { classId: "old", className: "초3 BS0A", date: "2026-08-10", subject: "math" };
    const out = buildAbsenceOptions([oldMath, engRow], "2026-08-19", new Set(["m1"]), "math");
    expect(out.options.map((o) => o.classId)).toEqual(["old"]);
    expect(out.options[0]!.pastClass).toBe(true);
  });

  it("과목이 다 걸러져 0건이 되면 뺀 건수가 남는다 — 화면이 '왜 비었는지'를 말할 수 있게", () => {
    const out = buildAbsenceOptions([engRow], "2026-08-19", new Set(), "math");
    expect(out.options).toEqual([]);
    expect(out.hiddenBySubject).toBe(1);
  });

  it("결석 자체가 없으면 뺀 건수도 0이다(두 빈 목록의 뜻이 갈린다)", () => {
    const out = buildAbsenceOptions([], "2026-08-19", new Set(), "math");
    expect(out.options).toEqual([]);
    expect(out.hiddenBySubject).toBe(0);
  });

  it("같은 (반,날짜)의 교시별 행은 접힌 뒤 한 건으로 센다(교시 수만큼 부풀지 않게)", () => {
    const out = buildAbsenceOptions(
      [
        { ...engRow, slotStart: "16:20" },
        { ...engRow, slotStart: "17:00" },
        { ...engRow, slotStart: "17:40" },
      ],
      "2026-08-19",
      new Set(),
      "math",
    );
    expect(out.hiddenBySubject).toBe(1);
  });
});

describe("subjectMatchesAnchor", () => {
  it("모르는 쪽은 통과 — 거르는 쪽이 아니라 남기는 쪽이 기본이다", () => {
    expect(subjectMatchesAnchor(null, "english")).toBe(true);
    expect(subjectMatchesAnchor("math", null)).toBe(true);
    expect(subjectMatchesAnchor("math", "")).toBe(true);
    expect(subjectMatchesAnchor("", "english")).toBe(true);
  });

  it("둘 다 있으면 같은 과목만", () => {
    expect(subjectMatchesAnchor("math", "math")).toBe(true);
    expect(subjectMatchesAnchor("math", "english")).toBe(false);
    expect(subjectMatchesAnchor(" math ", "math")).toBe(true);
  });
});
