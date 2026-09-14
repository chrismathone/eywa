/**
 * 출결 강사 귀속 축 — 순수 규칙 잠금.
 *
 * 실데이터 근거(injaewon, 2026-08-18 SELECT 실측):
 *  · 8월 교시별 기록 1,146행 중 **1,138행의 recorded_by가 김동후**(담임 반 0개) → 입력자는 귀속이 아니다.
 *  · 같은 1,146행을 (반·요일·시각·유효기간)으로 되짚으면 **198행이 담임 ≠ 교시 담당**이다.
 *  · 수학은 활성 슬롯 224개 전부 `teacher_id`가 null → 담임 폴백이 유일한 정답(축을 바꿔도 불변).
 */
import { describe, expect, it } from "vitest";
import {
  attendanceNoticeRecipients,
  axisDowOf,
  axisSlotFromRow,
  classTeacherIdsInRange,
  classTeacherRole,
  isSeatSlot,
  normalizeAxisTime,
  ownsAttendanceSlot,
  resolveTaughtBy,
  slotLiveOn,
  slotOverlapsRange,
  taughtByForSlot,
  type AxisSlot,
} from "./teacher-axis";

const HOMEROOM = "t-homeroom";
const SLOT_A = "t-slot-a";
const SLOT_B = "t-slot-b";

function slot(over: Partial<AxisSlot> = {}): AxisSlot {
  return {
    dayOfWeek: "wed",
    startTime: "16:20:00",
    teacherId: SLOT_A,
    slotTeacherLabel: null,
    validFrom: "2026-07-03",
    validTo: null,
    ...over,
  };
}

describe("시각·요일 정규화", () => {
  it("HH:MM:SS를 HH:MM으로 자른다", () => {
    expect(normalizeAxisTime("16:20:00")).toBe("16:20");
    expect(normalizeAxisTime("16:20")).toBe("16:20");
    expect(normalizeAxisTime(null)).toBeNull();
  });

  it("날짜에서 요일 enum을 뽑는다(2026-08-14 = 금요일)", () => {
    expect(axisDowOf("2026-08-14")).toBe("fri");
    expect(axisDowOf("2026-08-12")).toBe("wed");
    expect(axisDowOf("망가진 값")).toBeNull();
  });
});

describe("슬롯 유효기간", () => {
  it("끝난 교시는 그날의 후보가 아니다(#88 — 전 행을 그리면 옛 담당이 되살아난다)", () => {
    const ended = { validFrom: "2026-03-01", validTo: "2026-07-02" };
    expect(slotLiveOn(ended, "2026-06-30")).toBe(true);
    expect(slotLiveOn(ended, "2026-08-14")).toBe(false);
  });

  it("아직 시작 안 한 교시도 아니다", () => {
    expect(slotLiveOn({ validFrom: "2026-09-01", validTo: null }, "2026-08-14")).toBe(false);
  });

  it("기간 겹침은 한쪽 끝만 걸쳐도 참(월간 스코프)", () => {
    expect(slotOverlapsRange({ validFrom: "2026-08-20", validTo: null }, "2026-08-01", "2026-08-31")).toBe(true);
    expect(slotOverlapsRange({ validFrom: "2026-03-01", validTo: "2026-07-02" }, "2026-08-01", "2026-08-31")).toBe(false);
  });
});

describe("자리(LAB·JJ) 판정", () => {
  it("담당이 비어 있고 자리 라벨이면 자리다", () => {
    expect(isSeatSlot({ teacherId: null, slotTeacherLabel: "JJ" })).toBe(true);
    expect(isSeatSlot({ teacherId: null, slotTeacherLabel: "이주희" })).toBe(true); // LAB 별칭
  });

  it("사람이 배선돼 있으면 자리가 아니다(닉네임 라벨은 표시 전용)", () => {
    expect(isSeatSlot({ teacherId: SLOT_A, slotTeacherLabel: "Hannah" })).toBe(false);
  });
});

describe("출결 한 건의 귀속(resolveTaughtBy)", () => {
  it("교시 담당이 정해져 있으면 담임이 아니라 그 사람이다", () => {
    // 실데이터: 중등E_초6 의치대 수요일 16:20 = 김태건(담임 정유진).
    expect(
      resolveTaughtBy({
        homeroomTeacherId: HOMEROOM,
        slots: [slot({ teacherId: SLOT_A })],
        date: "2026-08-12", // 수
        slotStart: "16:20",
      }),
    ).toEqual({ teacherId: SLOT_A, source: "slot" });
  });

  it("같은 반이라도 요일이 다르면 다른 사람이다(요일별 담당 편성)", () => {
    const slots = [
      slot({ dayOfWeek: "wed", teacherId: SLOT_A }),
      slot({ dayOfWeek: "fri", teacherId: HOMEROOM }),
    ];
    expect(resolveTaughtBy({ homeroomTeacherId: HOMEROOM, slots, date: "2026-08-12", slotStart: "16:20" }).teacherId).toBe(SLOT_A);
    expect(resolveTaughtBy({ homeroomTeacherId: HOMEROOM, slots, date: "2026-08-14", slotStart: "16:20" }).teacherId).toBe(HOMEROOM);
  });

  it("담당이 미지정이면 담임으로 떨어진다(수학 활성 슬롯 224/224가 이 경로)", () => {
    expect(
      resolveTaughtBy({
        homeroomTeacherId: HOMEROOM,
        slots: [slot({ teacherId: null })],
        date: "2026-08-12",
        slotStart: "16:20",
      }),
    ).toEqual({ teacherId: HOMEROOM, source: "homeroom" });
  });

  it("시간표에 없는 날(보강)은 담임으로 떨어진다 — 근거가 없을 때의 기본값", () => {
    expect(
      resolveTaughtBy({
        homeroomTeacherId: HOMEROOM,
        slots: [slot({ dayOfWeek: "wed" })],
        date: "2026-08-16", // 일
        slotStart: "16:20",
      }),
    ).toEqual({ teacherId: HOMEROOM, source: "homeroom" });
  });

  it("자리(LAB·JJ) 수업은 담임으로 폴백하지 않는다 — 담임 시수로 잡히면 안 된다(0208a)", () => {
    expect(
      resolveTaughtBy({
        homeroomTeacherId: HOMEROOM,
        slots: [slot({ teacherId: null, slotTeacherLabel: "JJ" })],
        date: "2026-08-12",
        slotStart: "16:20",
      }),
    ).toEqual({ teacherId: null, source: "seat" });
  });

  it("모호하면(담당이 서로 다른 유효 슬롯 둘) 지어내지 않는다", () => {
    expect(
      resolveTaughtBy({
        homeroomTeacherId: HOMEROOM,
        slots: [slot({ teacherId: SLOT_A }), slot({ teacherId: SLOT_B })],
        date: "2026-08-12",
        slotStart: "16:20",
      }),
    ).toEqual({ teacherId: null, source: "ambiguous" });
  });

  it("'그날 전체' 기록은 교시를 특정 못 해 교시별 담당이 갈리면 모호다", () => {
    const slots = [
      slot({ startTime: "16:20:00", teacherId: SLOT_A }),
      slot({ startTime: "17:20:00", teacherId: SLOT_B }),
    ];
    expect(resolveTaughtBy({ homeroomTeacherId: HOMEROOM, slots, date: "2026-08-12", slotStart: null }).source).toBe(
      "ambiguous",
    );
  });

  it("'그날 전체'라도 담당이 한 사람뿐이면 그 사람이다(자리 슬롯은 세지 않는다)", () => {
    const slots = [
      slot({ startTime: "16:20:00", teacherId: SLOT_A }),
      slot({ startTime: "17:20:00", teacherId: null, slotTeacherLabel: "JJ" }),
    ];
    expect(resolveTaughtBy({ homeroomTeacherId: HOMEROOM, slots, date: "2026-08-12", slotStart: null })).toEqual({
      teacherId: SLOT_A,
      source: "slot",
    });
  });

  it("끝난 슬롯의 옛 담당은 되살아나지 않는다", () => {
    const slots = [
      slot({ teacherId: SLOT_B, validFrom: "2026-07-03", validTo: "2026-08-02" }),
      slot({ teacherId: SLOT_A, validFrom: "2026-08-03", validTo: null }),
    ];
    expect(resolveTaughtBy({ homeroomTeacherId: HOMEROOM, slots, date: "2026-08-12", slotStart: "16:20" })).toEqual({
      teacherId: SLOT_A,
      source: "slot",
    });
  });

  it("담임도 담당도 없으면 none — 빈 문자열이나 임의 선택으로 메우지 않는다", () => {
    expect(resolveTaughtBy({ homeroomTeacherId: null, slots: [], date: "2026-08-12" })).toEqual({
      teacherId: null,
      source: "none",
    });
  });
});

describe("단건 슬롯 귀속(taughtByForSlot) — 당일 출결 보드가 쓰는 단건판", () => {
  it("resolveTaughtBy와 같은 답을 낸다(자리·담당·폴백 3갈래)", () => {
    const cases: { teacherId: string | null; slotTeacherLabel: string | null; expect: ReturnType<typeof resolveTaughtBy> }[] = [
      { teacherId: SLOT_A, slotTeacherLabel: "Hannah", expect: { teacherId: SLOT_A, source: "slot" } },
      { teacherId: null, slotTeacherLabel: null, expect: { teacherId: HOMEROOM, source: "homeroom" } },
      { teacherId: null, slotTeacherLabel: "JJ", expect: { teacherId: null, source: "seat" } },
    ];
    for (const c of cases) {
      const single = taughtByForSlot({
        homeroomTeacherId: HOMEROOM,
        slot: { teacherId: c.teacherId, slotTeacherLabel: c.slotTeacherLabel },
      });
      expect(single).toEqual(c.expect);
      expect(
        resolveTaughtBy({
          homeroomTeacherId: HOMEROOM,
          slots: [slot({ teacherId: c.teacherId, slotTeacherLabel: c.slotTeacherLabel })],
          date: "2026-08-12",
          slotStart: "16:20",
        }),
      ).toEqual(c.expect);
    }
  });
});

describe("가시성 스코프(classTeacherIdsInRange)", () => {
  it("담임 ∪ 그 기간 교시 담당", () => {
    const ids = classTeacherIdsInRange({
      homeroomTeacherId: HOMEROOM,
      slots: [slot({ teacherId: SLOT_A }), slot({ dayOfWeek: "fri", teacherId: SLOT_B })],
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(new Set(ids)).toEqual(new Set([HOMEROOM, SLOT_A, SLOT_B]));
  });

  it("담임이 없어도 교시 담당만으로 보인다(Florence Park = 담임 0·교시 담당 5반)", () => {
    expect(
      classTeacherIdsInRange({
        homeroomTeacherId: null,
        slots: [slot({ teacherId: SLOT_A })],
        from: "2026-08-01",
        to: "2026-08-31",
      }),
    ).toEqual([SLOT_A]);
  });

  it("기간 밖 슬롯과 자리는 안 들어간다", () => {
    expect(
      classTeacherIdsInRange({
        homeroomTeacherId: HOMEROOM,
        slots: [
          slot({ teacherId: SLOT_A, validFrom: "2026-03-01", validTo: "2026-07-02" }),
          slot({ teacherId: null, slotTeacherLabel: "LAB" }),
        ],
        from: "2026-08-01",
        to: "2026-08-31",
      }),
    ).toEqual([HOMEROOM]);
  });

  it("🔴 담임 혼자 맡는 반은 **1명** — 월간 격자의 '이 반 전체 몫' 안내가 이 수로 갈린다", () => {
    // 수학이 여기 해당한다(활성 68개 반 중 담임 아닌 교시 담당이 있는 반 0개, 2026-08 실측).
    // 혼자 맡는 반에 "다른 선생님 화면에도 같은 값"을 붙이면 그 문장 자체가 거짓이다(적대적 리뷰 2026-08-19).
    expect(
      classTeacherIdsInRange({
        homeroomTeacherId: HOMEROOM,
        slots: [slot({ teacherId: null }), slot({ dayOfWeek: "fri", teacherId: null })],
        from: "2026-08-01",
        to: "2026-08-31",
      }),
    ).toEqual([HOMEROOM]);
  });

  it("모호(담당 둘)해도 둘 다 보인다 — 귀속과 달리 가시성은 넓게", () => {
    const ids = classTeacherIdsInRange({
      homeroomTeacherId: null,
      slots: [slot({ teacherId: SLOT_A }), slot({ teacherId: SLOT_B })],
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(new Set(ids)).toEqual(new Set([SLOT_A, SLOT_B]));
  });
});

describe("강사 전체 보기의 교시 귀속 — 원장 제보 2026-08-10 김근호 사례", () => {
  /**
   * 실데이터(중고E_중1 의치대, 월요일):
   *   16:20 정유진 / 17:20 이다교 / 18:20 JJ(자리). 담임은 정유진.
   * 출석부 칸이 그날 **모든 교시의 합**이라 이다교 선생님 화면에도 3으로 보였다 — 이다교 몫은 1이다.
   */
  const JEONG = "t-jeongyujin";
  const DAGYO = "t-idagyo";
  const monSlots: AxisSlot[] = [
    { dayOfWeek: "mon", startTime: "16:20:00", teacherId: JEONG, slotTeacherLabel: null, validFrom: "2026-07-03", validTo: null },
    { dayOfWeek: "mon", startTime: "17:20:00", teacherId: DAGYO, slotTeacherLabel: null, validFrom: "2026-08-03", validTo: null },
    { dayOfWeek: "mon", startTime: "18:20:00", teacherId: null, slotTeacherLabel: "JJ", validFrom: "2026-07-09", validTo: null },
  ];
  const owner = (slotStart: string) =>
    resolveTaughtBy({ homeroomTeacherId: JEONG, slots: monSlots, date: "2026-08-10", slotStart }).teacherId;

  it("교시마다 주인이 다르다", () => {
    expect(owner("16:20")).toBe(JEONG);
    expect(owner("17:20")).toBe(DAGYO);
  });

  it("🔴 이다교 화면에는 17:20 한 칸만 잡힌다(3이 아니라 1)", () => {
    const mine = ["16:20", "17:20", "18:20"].filter((s) => owner(s) === DAGYO);
    expect(mine).toEqual(["17:20"]);
  });

  it("자리(JJ)는 담임에게도 안 붙는다 — 그래서 강사 전체 보기에서 자동으로 빠진다", () => {
    expect(owner("18:20")).toBeNull();
    expect(["16:20", "17:20", "18:20"].filter((s) => owner(s) === JEONG)).toEqual(["16:20"]);
  });

  it("🔴 교시를 안 남긴 기록(day-level)은 **좁히지 않는다** — 수학 8,322/8,358건이 이 모양이다", () => {
    // 좁히면 담임 칸이 슬롯 담당에게 통째로 넘어가고(고등M 단체 BS4F: 이성우→유형숙 71건),
    // 파생(수업보고서)이 "수기 기록 없음"으로 보고 덮어써 수기 출석이 결석으로 뒤집혔다.
    for (const who of [JEONG, DAGYO]) {
      expect(
        ownsAttendanceSlot({
          scopeTeacherId: who,
          homeroomTeacherId: JEONG,
          slots: monSlots,
          date: "2026-08-10",
          slotStart: null,
        }),
        `${who}의 day-level 칸`,
      ).toBe(true);
    }
  });

  it("교시가 찍힌 기록만 좁힌다 — 이다교는 17:20만, 자리(JJ)는 아무에게도", () => {
    const owns = (who: string, slotStart: string) =>
      ownsAttendanceSlot({
        scopeTeacherId: who,
        homeroomTeacherId: JEONG,
        slots: monSlots,
        date: "2026-08-10",
        slotStart,
      });
    expect(["16:20", "17:20", "18:20"].filter((t) => owns(DAGYO, t))).toEqual(["17:20"]);
    expect(["16:20", "17:20", "18:20"].filter((t) => owns(JEONG, t))).toEqual(["16:20"]);
  });

  /**
   * 담임이 되기 **전** 칸 가리기(2026-08-19) — 원장 제보 *"김주현 선생님이 출결한것도 아닌데 보이는것"*.
   * 실데이터가 전부 day-level(수학)이라, 교시 판정보다 **먼저** 보지 않으면 아무 효과가 없다.
   */
  it("🔴 담임 시작일 이전 칸은 그 사람 몫이 아니다 — day-level 기록에도 걸린다", () => {
    const owns = (date: string, slotStart: string | null) =>
      ownsAttendanceSlot({
        scopeTeacherId: JEONG,
        homeroomTeacherId: JEONG,
        slots: monSlots,
        date,
        slotStart,
        homeroomSince: "2026-08-10",
      });
    expect(owns("2026-08-03", null), "담임 이전 day-level").toBe(false);
    expect(owns("2026-08-03", "16:20"), "담임 이전 교시").toBe(false);
    expect(owns("2026-08-10", null), "담임 시작일 당일은 포함").toBe(true);
    expect(owns("2026-08-17", null), "담임 이후").toBe(true);
  });

  it("🔴 근거가 없으면(null) 아무것도 가리지 않는다 — 폴백이 안전벨트", () => {
    for (const since of [null, undefined]) {
      expect(
        ownsAttendanceSlot({
          scopeTeacherId: JEONG,
          homeroomTeacherId: JEONG,
          slots: monSlots,
          date: "2026-01-01",
          slotStart: null,
          homeroomSince: since,
        }),
      ).toBe(true);
    }
  });

  it("🔴 자리 라벨이 박힌 기록(랩실 자리 시수)은 어느 강사 몫도 아니다 — 반 교시 밖 시각이어도", () => {
    // 자리 출석부 '다른 시간으로 옮기기'(원장 2026-09-10): 그 반 슬롯이 없는 시각에 찍힌 자리 기록은
    // 슬롯 판정만으로는 담임 폴백을 타 담임 값이 된다 — 정산(tier-rows)은 seat_label로 빼므로 화면 ≠ 정산.
    const owns = (who: string | null, slotStart: string | null, seatLabel: string | null) =>
      ownsAttendanceSlot({
        scopeTeacherId: who,
        homeroomTeacherId: JEONG,
        slots: monSlots,
        date: "2026-08-10",
        slotStart,
        seatLabel,
      });
    expect(owns(JEONG, "19:40", "LAB"), "슬롯 없는 시각의 자리 기록").toBe(false);
    expect(owns(JEONG, "19:40", null), "같은 시각의 반 기록은 종전대로 담임 폴백").toBe(true);
    expect(owns(JEONG, "16:20", "LAB"), "자리 기록은 담임 교시 시각이어도 담임 값이 아니다").toBe(false);
    expect(owns(null, "19:40", "LAB"), "반별 보기는 전부 그 반 몫").toBe(true);
    expect(owns(JEONG, "16:20", "  "), "공백 라벨은 라벨이 아니다").toBe(true);
  });

  it("반별 보기는 담임 시작일을 넘겨도 영향 없다 — 반 관점에선 그 기록이 맞다", () => {
    expect(
      ownsAttendanceSlot({
        scopeTeacherId: null,
        homeroomTeacherId: JEONG,
        slots: monSlots,
        date: "2026-08-03",
        slotStart: null,
        homeroomSince: "2026-08-10",
      }),
    ).toBe(true);
  });

  it("반별 보기(scope 없음)는 전부 그 반 몫 — 종전과 같은 숫자", () => {
    for (const slotStart of ["16:20", "18:20", null]) {
      expect(
        ownsAttendanceSlot({
          scopeTeacherId: null,
          homeroomTeacherId: JEONG,
          slots: monSlots,
          date: "2026-08-10",
          slotStart,
        }),
      ).toBe(true);
    }
  });

  it("담당이 미지정인 교시는 담임 몫이다 — 수학처럼 슬롯을 안 채운 반은 종전과 같다", () => {
    const bare: AxisSlot[] = [
      { dayOfWeek: "mon", startTime: "16:20:00", teacherId: null, slotTeacherLabel: null, validFrom: "2026-07-03", validTo: null },
    ];
    expect(
      resolveTaughtBy({ homeroomTeacherId: JEONG, slots: bare, date: "2026-08-10", slotStart: "16:20" })
        .teacherId,
    ).toBe(JEONG);
  });
});

describe("반 안에서의 역할 표식", () => {
  it("담임/교시 담당/둘 다/아님", () => {
    const base = { homeroomTeacherId: HOMEROOM, slotTeacherIds: [SLOT_A, HOMEROOM] };
    expect(classTeacherRole({ ...base, teacherId: HOMEROOM })).toBe("both");
    expect(classTeacherRole({ ...base, teacherId: SLOT_A })).toBe("slot");
    expect(classTeacherRole({ homeroomTeacherId: HOMEROOM, slotTeacherIds: [], teacherId: HOMEROOM })).toBe("homeroom");
    expect(classTeacherRole({ ...base, teacherId: SLOT_B })).toBeNull();
  });
});

/**
 * 출결 알림 벨 수신자 — "그날 그 교시 담당 + 담임"(원장 결정 2026-09-14).
 * 실측 모양: LT4(월요일) 오늘 담당은 한 사람인데 반의 슬롯 이력에 끝난 담당·다른 요일 담당이 섞여 있어
 * 종전 규칙(반의 슬롯 teacher_id 전부)으로는 그들까지 벨을 받았다.
 */
describe("출결 알림 수신자(attendanceNoticeRecipients)", () => {
  const MON = "2026-09-14"; // 월요일
  const TODAY_1620 = "t-today-1620";
  const TODAY_1720 = "t-today-1720";
  const ENDED = "t-ended";
  const OTHER_DAY = "t-other-day";
  const FUTURE = "t-future";
  const REQUESTER = "t-requester";

  const lt4: AxisSlot[] = [
    slot({ dayOfWeek: "mon", startTime: "16:20:00", teacherId: TODAY_1620, validFrom: "2026-09-01" }),
    slot({ dayOfWeek: "mon", startTime: "17:20:00", teacherId: TODAY_1720, validFrom: "2026-09-01" }),
    // 끝난 배치 이력(8월까지) — 종전 규칙이 벨을 보내던 대상.
    slot({ dayOfWeek: "mon", startTime: "16:20:00", teacherId: ENDED, validFrom: "2026-03-02", validTo: "2026-08-31" }),
    // 다른 요일 담당.
    slot({ dayOfWeek: "wed", startTime: "16:20:00", teacherId: OTHER_DAY, validFrom: "2026-09-01" }),
    // 아직 시작 안 한 예약 배치.
    slot({ dayOfWeek: "mon", startTime: "16:20:00", teacherId: FUTURE, validFrom: "2026-10-05" }),
    // 자리(LAB) — 사람이 아니다.
    slot({ dayOfWeek: "mon", startTime: "18:20:00", teacherId: null, slotTeacherLabel: "LAB", validFrom: "2026-09-01" }),
  ];

  it("교시가 주어지면 그 교시 담당 + 담임만 — 끝난 이력·다른 요일·다른 교시·예약은 빠진다", () => {
    expect(
      attendanceNoticeRecipients({ homeroomTeacherId: HOMEROOM, slots: lt4, date: MON, slotStart: "16:20" }).sort(),
    ).toEqual([HOMEROOM, TODAY_1620].sort());
  });

  it("교시가 null이면 그날 유효한 모든 교시 담당 + 담임(수학은 하루 한 행이 저장 축)", () => {
    expect(
      attendanceNoticeRecipients({ homeroomTeacherId: HOMEROOM, slots: lt4, date: MON, slotStart: null }).sort(),
    ).toEqual([HOMEROOM, TODAY_1620, TODAY_1720].sort());
  });

  it("유효기간 경계는 양쪽 다 포함한다(시작일·마감일 당일은 그 담당이 가르친다)", () => {
    const edge: AxisSlot[] = [
      slot({ dayOfWeek: "mon", teacherId: SLOT_A, validFrom: MON, validTo: null }),
      slot({ dayOfWeek: "mon", teacherId: SLOT_B, validFrom: "2026-03-02", validTo: MON }),
      slot({ dayOfWeek: "mon", teacherId: ENDED, validFrom: "2026-03-02", validTo: "2026-09-13" }),
    ];
    expect(
      attendanceNoticeRecipients({ homeroomTeacherId: null, slots: edge, date: MON, slotStart: "16:20" }).sort(),
    ).toEqual([SLOT_A, SLOT_B].sort());
  });

  it("자리(LAB·JJ) 교시는 아무도 더하지 않는다 — 담임은 그대로 받는다", () => {
    expect(
      attendanceNoticeRecipients({ homeroomTeacherId: HOMEROOM, slots: lt4, date: MON, slotStart: "18:20" }),
    ).toEqual([HOMEROOM]);
  });

  it("시각 표기(HH:MM:SS ↔ HH:MM)가 달라도 같은 교시로 본다", () => {
    expect(
      attendanceNoticeRecipients({ homeroomTeacherId: null, slots: lt4, date: MON, slotStart: "17:20:00" }),
    ).toEqual([TODAY_1720]);
  });

  it("좌석표 저장(첫 교시)과 지금 교시가 다르면 두 교시 담당이 함께 받는다 — 사이 교시는 빠진다", () => {
    const threeTeachers: AxisSlot[] = [
      slot({ dayOfWeek: "mon", startTime: "16:20:00", teacherId: SLOT_A }),
      slot({ dayOfWeek: "mon", startTime: "17:20:00", teacherId: SLOT_B }),
      slot({ dayOfWeek: "mon", startTime: "18:20:00", teacherId: TODAY_1720 }),
    ];
    expect(
      attendanceNoticeRecipients({
        homeroomTeacherId: HOMEROOM,
        slots: threeTeachers,
        date: MON,
        slotStart: "16:20",
        periodStart: "18:20",
      }).sort(),
    ).toEqual([HOMEROOM, SLOT_A, TODAY_1720].sort());
    // 지금 교시가 저장 교시와 같으면 종전과 같다.
    expect(
      attendanceNoticeRecipients({
        homeroomTeacherId: HOMEROOM,
        slots: threeTeachers,
        date: MON,
        slotStart: "16:20",
        periodStart: "16:20:00",
      }).sort(),
    ).toEqual([HOMEROOM, SLOT_A].sort());
    // 그날 전체(null)면 지금 교시와 무관하게 모든 교시.
    expect(
      attendanceNoticeRecipients({
        homeroomTeacherId: null,
        slots: threeTeachers,
        date: MON,
        slotStart: null,
        periodStart: "18:20",
      }).sort(),
    ).toEqual([SLOT_A, SLOT_B, TODAY_1720].sort());
  });

  it("맞는 교시가 없으면(시간표에 없는 보강 칸) 담임만 남는다", () => {
    expect(
      attendanceNoticeRecipients({ homeroomTeacherId: HOMEROOM, slots: lt4, date: MON, slotStart: "20:00" }),
    ).toEqual([HOMEROOM]);
  });

  it("한 교시에 담당이 둘이면 둘 다 받는다(귀속은 모호로 비우지만 벨은 누가 찍어도 된다)", () => {
    const twin: AxisSlot[] = [
      slot({ dayOfWeek: "mon", teacherId: SLOT_A }),
      slot({ dayOfWeek: "mon", teacherId: SLOT_B }),
    ];
    expect(
      attendanceNoticeRecipients({ homeroomTeacherId: null, slots: twin, date: MON, slotStart: "16:20" }).sort(),
    ).toEqual([SLOT_A, SLOT_B].sort());
  });

  it("보낸 사람 본인은 담임이든 교시 담당이든 뺀다 · 담임이 교시 담당이어도 한 번만", () => {
    const self: AxisSlot[] = [
      slot({ dayOfWeek: "mon", teacherId: REQUESTER }),
      slot({ dayOfWeek: "mon", startTime: "17:20:00", teacherId: HOMEROOM }),
    ];
    expect(
      attendanceNoticeRecipients({
        homeroomTeacherId: REQUESTER,
        slots: self,
        date: MON,
        slotStart: null,
        excludeId: REQUESTER,
      }),
    ).toEqual([HOMEROOM]);
    expect(
      attendanceNoticeRecipients({ homeroomTeacherId: HOMEROOM, slots: self, date: MON, slotStart: "17:20" }),
    ).toEqual([HOMEROOM]);
  });

  it("담임도 유효 교시도 없으면 빈 목록 · 날짜가 망가졌으면 담임만", () => {
    expect(attendanceNoticeRecipients({ homeroomTeacherId: null, slots: lt4, date: "2026-09-15", slotStart: null })).toEqual([]);
    expect(
      attendanceNoticeRecipients({ homeroomTeacherId: HOMEROOM, slots: lt4, date: "망가진 값", slotStart: null }),
    ).toEqual([HOMEROOM]);
  });

  /**
   * 임시 위임 대체 강사 — 원장 결정 2026-09-14: *"결근 대체로 반을 임시 위임받은 강사도 그날 [요청]·교차 알림
   * 벨을 받는다. 교시 담당·담임은 지금처럼 받는다."*
   */
  describe("임시 위임 대체 강사(class_delegations)", () => {
    const DELEGATE = "t-delegate";
    const today = { delegateUserId: DELEGATE, fromDate: MON, toDate: MON };

    it("그날 위임받은 대체 강사도 받는다 — 교시 담당·담임은 그대로 받는다", () => {
      expect(
        attendanceNoticeRecipients({
          homeroomTeacherId: HOMEROOM,
          slots: lt4,
          date: MON,
          slotStart: "16:20",
          delegations: [today],
        }).sort(),
      ).toEqual([HOMEROOM, TODAY_1620, DELEGATE].sort());
    });

    it("위임은 반 전체라 교시로 거르지 않는다 — 자리 교시·그날 전체·시간표에 없는 교시에도 받는다", () => {
      for (const slotStart of ["18:20", null, "20:00"]) {
        expect(
          attendanceNoticeRecipients({
            homeroomTeacherId: HOMEROOM,
            slots: lt4,
            date: MON,
            slotStart,
            delegations: [today],
          }),
          `slotStart=${slotStart}`,
        ).toContain(DELEGATE);
      }
    });

    it("보낸 사람이 대체 강사면 뺀다", () => {
      expect(
        attendanceNoticeRecipients({
          homeroomTeacherId: HOMEROOM,
          slots: lt4,
          date: MON,
          slotStart: "16:20",
          delegations: [today],
          excludeId: DELEGATE,
        }).sort(),
      ).toEqual([HOMEROOM, TODAY_1620].sort());
    });

    it("대체 강사가 담임·교시 담당과 같은 사람이면 한 번만(같은 반에 위임이 둘 걸려도)", () => {
      expect(
        attendanceNoticeRecipients({
          homeroomTeacherId: HOMEROOM,
          slots: lt4,
          date: MON,
          slotStart: "16:20",
          delegations: [
            { delegateUserId: HOMEROOM, fromDate: MON, toDate: MON },
            { delegateUserId: TODAY_1620, fromDate: "2026-09-10", toDate: "2026-09-20" },
            today,
            { ...today },
          ],
        }).sort(),
      ).toEqual([HOMEROOM, TODAY_1620, DELEGATE].sort());
    });

    it("기간 밖·해제된·깨진 위임은 받지 않는다 — 양끝(시작일·종료일 당일)은 포함", () => {
      const ended = "t-ended-delegate";
      const upcoming = "t-upcoming-delegate";
      const revoked = "t-revoked-delegate";
      const broken = "t-broken-delegate";
      const startsToday = "t-starts-today";
      const endsToday = "t-ends-today";
      expect(
        attendanceNoticeRecipients({
          homeroomTeacherId: HOMEROOM,
          slots: [],
          date: MON,
          slotStart: null,
          delegations: [
            { delegateUserId: ended, fromDate: "2026-09-07", toDate: "2026-09-13" },
            { delegateUserId: upcoming, fromDate: "2026-09-15", toDate: "2026-09-18" },
            { delegateUserId: revoked, fromDate: MON, toDate: MON, revokedAt: "2026-09-13T09:00:00+09:00" },
            { delegateUserId: broken, fromDate: "망가진 값", toDate: MON },
            { delegateUserId: startsToday, fromDate: MON, toDate: "2026-09-20" },
            { delegateUserId: endsToday, fromDate: "2026-09-10", toDate: MON },
          ],
        }).sort(),
      ).toEqual([HOMEROOM, startsToday, endsToday].sort());
    });

    it("위임을 안 넘기거나 빈 목록이면 종전과 같다", () => {
      const base = { homeroomTeacherId: HOMEROOM, slots: lt4, date: MON, slotStart: "16:20" } as const;
      const before = attendanceNoticeRecipients(base).sort();
      expect(attendanceNoticeRecipients({ ...base, delegations: [] }).sort()).toEqual(before);
      expect(before).toEqual([HOMEROOM, TODAY_1620].sort());
    });
  });

  it("행 모양 변환은 컬럼을 그대로 옮긴다", () => {
    expect(
      axisSlotFromRow({
        day_of_week: "mon",
        start_time: "16:20:00",
        teacher_id: SLOT_A,
        slot_teacher_label: null,
        valid_from: "2026-09-01",
        valid_to: null,
      }),
    ).toEqual({
      dayOfWeek: "mon",
      startTime: "16:20:00",
      teacherId: SLOT_A,
      slotTeacherLabel: null,
      validFrom: "2026-09-01",
      validTo: null,
    });
  });
});
