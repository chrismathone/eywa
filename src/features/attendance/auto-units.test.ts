import { describe, expect, it } from "vitest";
import {
  AUTO_UNITS_SUBJECTS,
  autoUnitsApply,
  autoUnitsByDate,
  autoUnitsKey,
  autoUnitsLogFields,
  autoUnitsOn,
  isAutoUnitsSubject,
  newRowUnits,
  planAutoUnits,
  toAutoUnitsSchedule,
  unitsFromMinutes,
  type AutoUnitsSchedule,
} from "./auto-units";

// 2026-09-01은 화요일 — 아래 날짜는 그 주 기준.
const MON = "2026-09-07";
const WED = "2026-09-09";
const THU = "2026-09-10";

const s = (
  dow: AutoUnitsSchedule["dayOfWeek"],
  start: string,
  end: string,
  over: Partial<AutoUnitsSchedule> = {},
): AutoUnitsSchedule => ({
  dayOfWeek: dow,
  startTime: `${start}:00`,
  endTime: `${end}:00`,
  validFrom: "2026-03-01",
  validTo: null,
  slotTeacherLabel: null,
  ...over,
});
/** 실측 모양(이성우 반 BS2F·CR3D 월목): 55분 × 3교시 = 165분. */
const threeBy55 = (dow: AutoUnitsSchedule["dayOfWeek"]) => [
  s(dow, "16:00", "16:55"),
  s(dow, "17:00", "17:55"),
  s(dow, "18:00", "18:55"),
];

describe("unitsFromMinutes — max(1, round(분÷60)÷2) (원장 2026-09-11 '그날 수업 길이로 자동')", () => {
  it("원장에게 보여 준 표 그대로", () => {
    expect(unitsFromMinutes(165)).toBe(1.5); // 3교시 2시간 45분
    expect(unitsFromMinutes(180)).toBe(1.5); // 3시간
    expect(unitsFromMinutes(240)).toBe(2); // 4시간
  });

  it("2시간 이하는 1 = 자동 안 함(null — 저장 규약상 1은 null)", () => {
    for (const m of [55, 110, 115, 120]) expect(unitsFromMinutes(m), String(m)).toBeNull();
  });

  it("수업이 없거나 값이 이상하면 null — 돈 값을 지어내지 않는다", () => {
    for (const m of [0, -30, Number.NaN, Number.POSITIVE_INFINITY]) expect(unitsFromMinutes(m), String(m)).toBeNull();
  });

  it("0.5 단위로만 나오고 상한(20)을 넘지 않는다", () => {
    expect(unitsFromMinutes(300)).toBe(2.5);
    expect(unitsFromMinutes(99_999)).toBe(20);
    for (let m = 1; m <= 900; m++) {
      const u = unitsFromMinutes(m);
      if (u !== null) expect((u * 2) % 1, String(m)).toBe(0);
    }
  });
});

describe("autoUnitsOn — 그날 유효 배치의 분 합(ECS 유닛 자동값과 같은 분 계산)", () => {
  it("🔴 55분 × 3교시 = 1.5 — 이 기능이 생긴 이유", () => {
    expect(autoUnitsOn(THU, threeBy55("thu"))).toBe(1.5);
    expect(autoUnitsOn(MON, threeBy55("mon"))).toBe(1.5);
  });

  it("그 요일 배치가 없으면 null(자동 안 함)", () => {
    expect(autoUnitsOn(WED, threeBy55("thu"))).toBeNull();
    expect(autoUnitsOn(THU, [])).toBeNull();
  });

  it("🔴 자리(LAB·JJ) 교시는 수업 시수가 아니다 — 언제나 뺀다", () => {
    const withLab = [s("thu", "16:00", "17:00"), s("thu", "17:00", "18:00"), s("thu", "18:00", "19:00", { slotTeacherLabel: "LAB" })];
    expect(autoUnitsOn(THU, withLab)).toBeNull(); // 120분 = 1 (LAB을 세면 180분 = 1.5)
    const withJj = [s("thu", "16:00", "17:00"), s("thu", "17:00", "18:00"), s("thu", "18:00", "19:00", { slotTeacherLabel: "jj" })];
    expect(autoUnitsOn(THU, withJj)).toBeNull();
  });

  it("🔴 같은 시작 시각은 한 번만 센다", () => {
    const dup = [s("thu", "16:00", "17:00"), s("thu", "16:00", "17:00"), s("thu", "17:00", "18:00")];
    expect(autoUnitsOn(THU, dup)).toBeNull(); // 120분(두 번 세면 180분 = 1.5)
  });

  it("그 날짜에 유효하지 않은 배치(만료·미시작)는 안 센다", () => {
    const rows = [
      ...threeBy55("thu").slice(0, 2),
      s("thu", "18:00", "18:55", { validTo: "2026-09-09" }),
      s("thu", "19:00", "19:55", { validFrom: "2026-09-11" }),
    ];
    expect(autoUnitsOn(THU, rows)).toBeNull(); // 110분만 산다
  });
});

describe("autoUnitsApply — 새 행에 자동값을 받을 수 있는 저장", () => {
  it("숫자 안 고름(원문 없음·공백) + 그날 전체 행 + 소비 상태", () => {
    for (const raw of [undefined, null, "", "   "]) {
      expect(autoUnitsApply({ rawUnits: raw, slotStart: null, status: "present" }), String(raw)).toBe(true);
    }
    for (const st of ["present", "late", "early_leave", "makeup"]) {
      expect(autoUnitsApply({ rawUnits: "", slotStart: null, status: st }), st).toBe(true);
    }
  });

  it("🔴 사람이 친 숫자는 그대로 — \"1\"도 명시다(원장 2026-09-01 '입력된 숫자가 입력되도록')", () => {
    for (const raw of ["1", "1.5", "2", "0.5"]) {
      expect(autoUnitsApply({ rawUnits: raw, slotStart: null, status: "present" }), raw).toBe(false);
    }
  });

  it("교시별 행(영어·자리 축)은 대상이 아니다", () => {
    expect(autoUnitsApply({ rawUnits: "", slotStart: "16:20", status: "present" })).toBe(false);
  });

  it("결석·공결·지우기엔 시수가 없다", () => {
    for (const st of ["absent", "excused", null, undefined]) {
      expect(autoUnitsApply({ rawUnits: "", slotStart: null, status: st }), String(st)).toBe(false);
    }
  });
});

describe("newRowUnits — 새 행의 시수: 친 숫자가 먼저, 안 골랐을 때만 자동값", () => {
  it("🔴 친 숫자는 자동값이 있어도 그대로 — \"1\" = null(=1) · \"2\" = 2 (원장 2026-09-01)", () => {
    expect(newRowUnits("1", null, 1.5)).toEqual({ units: null, auto: undefined });
    expect(newRowUnits("2", 2, 1.5)).toEqual({ units: 2, auto: undefined });
    expect(newRowUnits(" 0.5 ", 0.5, 2)).toEqual({ units: 0.5, auto: undefined });
  });

  it("숫자를 안 골랐으면(원문 없음·공백) 자동값 — 판정을 탄 행은 auto에 실제 저장값", () => {
    for (const raw of [undefined, null, "", "  "]) {
      expect(newRowUnits(raw, null, 1.5), String(raw)).toEqual({ units: 1.5, auto: 1.5 });
      // 판정은 탔는데 값이 없다(비수학·2시간 이하·조회 실패) → null(=1)도 '자동으로 들어간 값'이다.
      expect(newRowUnits(raw, null, null), String(raw)).toEqual({ units: null, auto: null });
    }
  });

  it("판정 밖(결석·교시별 행 — auto undefined)이면 종전 값 그대로", () => {
    expect(newRowUnits("", null, undefined)).toEqual({ units: null, auto: undefined });
    expect(newRowUnits(undefined, null, undefined)).toEqual({ units: null, auto: undefined });
  });
});

describe("planAutoUnits — 과목·배치로 칸별 값", () => {
  const MATH = "math-class";
  const ENG = "eng-class";
  const subjectOf = new Map<string, string | null>([
    [MATH, "math"],
    [ENG, "english"],
  ]);
  const schedulesOf = new Map([
    [MATH, threeBy55("thu")],
    [ENG, threeBy55("thu")],
  ]);

  it("🔴 수학만 — 같은 165분이어도 영어 반은 자동값이 없다(원장 2026-08-10 ECS '다 1')", () => {
    const got = planAutoUnits(
      [
        { classId: MATH, date: THU },
        { classId: ENG, date: THU },
      ],
      subjectOf,
      schedulesOf,
    );
    expect(got.get(autoUnitsKey(MATH, THU))).toBe(1.5);
    expect(got.has(autoUnitsKey(ENG, THU))).toBe(false);
  });

  it("조회에서 빠진(모르는) 반은 값을 지어내지 않는다", () => {
    expect(planAutoUnits([{ classId: "unknown", date: THU }], subjectOf, schedulesOf).size).toBe(0);
  });

  it("값이 1이면 키가 없다(종전처럼 null 저장)", () => {
    const two = new Map([[MATH, [s("thu", "16:00", "17:00"), s("thu", "17:00", "18:00")]]]);
    expect(planAutoUnits([{ classId: MATH, date: THU }], subjectOf, two).size).toBe(0);
  });

  it("같은 (반, 날짜)가 여러 번 와도 한 번만", () => {
    const got = planAutoUnits(
      [
        { classId: MATH, date: THU },
        { classId: MATH, date: THU },
        { classId: MATH, date: MON },
      ],
      subjectOf,
      schedulesOf,
    );
    expect([...got.keys()]).toEqual([autoUnitsKey(MATH, THU)]);
  });

  it("과목 키는 math 하나뿐 — 영어를 넣으려면 원장 확인(ECS '다 1' 결정)", () => {
    expect([...AUTO_UNITS_SUBJECTS]).toEqual(["math"]);
    expect(isAutoUnitsSubject("math")).toBe(true);
    expect(isAutoUnitsSubject("english")).toBe(false);
    expect(isAutoUnitsSubject(null)).toBe(false);
  });
});

describe("보조 함수", () => {
  it("autoUnitsByDate — 날짜별(1·배치 없음은 키 없음)", () => {
    const rows = [...threeBy55("mon"), ...threeBy55("thu"), s("wed", "16:00", "17:00")];
    expect(autoUnitsByDate([MON, "2026-09-08", WED, THU], rows)).toEqual({ [MON]: 1.5, [THU]: 1.5 });
  });

  it("toAutoUnitsSchedule — DB 행(snake) → 판정 모양", () => {
    expect(
      toAutoUnitsSchedule({
        day_of_week: "thu",
        start_time: "16:00:00",
        end_time: "16:55:00",
        valid_from: "2026-09-01",
        valid_to: null,
        slot_teacher_label: "LAB",
      }),
    ).toEqual(s("thu", "16:00", "16:55", { validFrom: "2026-09-01", slotTeacherLabel: "LAB" }));
  });

  it("autoUnitsLogFields — 들어간 칸이 없으면 빈 객체(평시 로그를 늘리지 않는다)", () => {
    expect(autoUnitsLogFields([])).toEqual({});
    expect(autoUnitsLogFields([1.5, 1.5, 2])).toEqual({ autoUnitsCells: 3, autoUnitsByValue: { "1.5": 2, "2": 1 } });
  });
});
