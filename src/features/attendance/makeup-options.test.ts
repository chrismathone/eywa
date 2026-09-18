import { describe, expect, it } from "vitest";
import {
  absenceOptionLabel,
  buildAbsenceOptions,
  isWithinMakeupDeadline,
  makeupDeadlineOf,
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

/**
 * 앵커가 **없을 때**(반 보강이 아닌 그냥 보강) — 강사 본인 과목으로 좁힌다.
 * 원장 2026-09-02: *"수학선생님이나 영어선생님이 보강 추가할때 본인 과목만 팝업되게 해줘."*
 */
describe("앵커 없는 보강 — 강사 과목 폴백", () => {
  const rows = [
    { classId: "m1", className: "중등M 초6", date: "2026-08-20", subject: "math" },
    { classId: "e1", className: "중등E_초6 MED", date: "2026-08-19", subject: "english" },
    { classId: "x1", className: "미분류반", date: "2026-08-18", subject: null },
  ];

  it("🔴 수학 강사는 영어 결석을 안 본다(뺀 건수는 함께 돌려준다)", () => {
    const r = buildAbsenceOptions(rows, "2026-09-02", new Set(), null, ["math"]);
    expect(r.options.map((o) => o.classId)).toEqual(["m1", "x1"]);
    expect(r.hiddenBySubject).toBe(1);
  });

  it("겸직(두 과목)은 둘 다 본다", () => {
    const r = buildAbsenceOptions(rows, "2026-09-02", new Set(), null, ["math", "english"]);
    expect(r.options).toHaveLength(3);
    expect(r.hiddenBySubject).toBe(0);
  });

  it("🔴 과목을 모르면(사무실 계정·담당 반 0개) 아무것도 안 거른다 — 후보가 사라지는 쪽이 더 나쁘다", () => {
    expect(buildAbsenceOptions(rows, "2026-09-02", new Set(), null, []).options).toHaveLength(3);
    expect(buildAbsenceOptions(rows, "2026-09-02", new Set(), null, null).options).toHaveLength(3);
  });

  it("🔴 앵커가 있으면 앵커가 이긴다(폴백은 무시)", () => {
    const r = buildAbsenceOptions(rows, "2026-09-02", new Set(), "english", ["math"]);
    expect(r.options.map((o) => o.classId)).toEqual(["e1", "x1"]);
  });
});

describe("보강 기한 — 결석한 달의 다음 달 말일(원장 2026-09-18 \"9월 결석이면 10월 마지막날까지\")", () => {
  it("날 수가 아니라 달로 센다 — 그 달 첫날·끝날 결석 모두 다음 달 말일", () => {
    expect(makeupDeadlineOf("2026-09-01")).toBe("2026-10-31");
    expect(makeupDeadlineOf("2026-09-30")).toBe("2026-10-31");
    expect(makeupDeadlineOf("2026-08-20")).toBe("2026-09-30");
  });
  it("해를 넘기고 · 짧은 달 · 윤년", () => {
    expect(makeupDeadlineOf("2026-12-15")).toBe("2027-01-31");
    expect(makeupDeadlineOf("2026-01-31")).toBe("2026-02-28");
    expect(makeupDeadlineOf("2028-01-10")).toBe("2028-02-29");
  });
  it("형식이 아니면 판정하지 않는다(막지 않는다)", () => {
    expect(makeupDeadlineOf("9/10")).toBe("");
    expect(isWithinMakeupDeadline("9/10", "2026-09-18")).toBe(true);
  });
  it("기한 당일까지는 되고 다음 날부터 안 된다", () => {
    expect(isWithinMakeupDeadline("2026-09-10", "2026-10-31")).toBe(true);
    expect(isWithinMakeupDeadline("2026-09-10", "2026-11-01")).toBe(false);
  });
  it("🔴 선보강(결석일이 보강일보다 뒤)은 언제나 된다 — 시험 직전에 당겨 하는 보강", () => {
    expect(isWithinMakeupDeadline("2026-10-10", "2026-10-05")).toBe(true);
  });

  it("강사뷰만 거르고 뺀 수를 함께 준다 — 사무실 화면(기본)은 종전 그대로", () => {
    const rows = [
      row("c1", "초6 MS2A", "2026-09-10"),
      row("c1", "초6 MS2A", "2026-08-20"),
      row("c1", "초6 MS2A", "2026-07-31"),
      row("c1", "초6 MS2A", "2026-06-04"),
    ];
    const teacher = buildAbsenceOptions(rows, "2026-09-18", new Set(), null, null, { deadline: true });
    expect(teacher.options.map((o) => o.date)).toEqual(["2026-09-10", "2026-08-20"]);
    expect(teacher.hiddenByDeadline).toBe(2);

    const office = buildAbsenceOptions(rows, "2026-09-18");
    expect(office.options).toHaveLength(4);
    // 🔑 사무실 화면엔 이 칸 자체가 없다 — 화면이 '기한을 거는 화면인가'를 이 유무로 안다.
    expect("hiddenByDeadline" in office).toBe(false);
  });

  it("기한 수는 과목 필터 **뒤**에 센다 — 한 결석을 두 숫자에 겹쳐 세지 않는다", () => {
    const rows: AbsenceRow[] = [
      { classId: "m", className: "수학", date: "2026-06-04", subject: "math" },
      { classId: "e", className: "영어", date: "2026-06-05", subject: "english" },
      { classId: "m", className: "수학", date: "2026-09-10", subject: "math" },
    ];
    const out = buildAbsenceOptions(rows, "2026-09-18", new Set(), "math", null, { deadline: true });
    expect(out.options.map((o) => o.date)).toEqual(["2026-09-10"]);
    expect(out.hiddenBySubject).toBe(1);
    expect(out.hiddenByDeadline).toBe(1);
  });
});
