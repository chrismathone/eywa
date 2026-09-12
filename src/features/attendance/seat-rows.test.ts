/**
 * 🔴 원장 2026-09-12 *"jj는 개인강사 출석부에 넣음 안되지."* — 강사 보기 저장이 **자리(JJ·랩실) 행을 안 건드리려면**
 * "이 행이 자리인가"를 저장과 화면이 **같은 답**으로 알아야 한다. 그 판정 한 벌을 여기서 잠근다:
 *   · 축   `attendanceSlotShare` — 몫(`mine`)은 `ownsAttendanceSlot` 그대로, 나머지를 자리·그 밖으로 가른다
 *   · 스코프 `buildScopeShare`   — 같은 답을 (반·날짜·행)으로 풀어 준다(저장 액션이 쓰는 판정기)
 *   · 빼기 `splitOutSeatRows`    — 쓰는 행 / 손대지 않는 자리 행
 *
 * ⚠️ 실례의 함정: **JJ실은 `seat_label`을 안 박는다**(랩실만 박는다) — 라벨만 보면 9/10 박서연D의 그 JJ 행을 놓친다.
 *    자리 여부는 **그 교시가 자리 슬롯인가**로도 봐야 한다.
 */
import { describe, expect, it } from "vitest";
import { attendanceSlotShare, ownsAttendanceSlot, type AxisSlot } from "./teacher-axis";
import { buildScopeShare, type ScopeClassFacts } from "./scope-ownership";
import { splitOutSeatRows, type DayTargetRow } from "./scoped-split";

const CLASS = "c-mid2a";
const HOMEROOM = "t-homeroom";
const CHARLIE = "t-charlie";
const OTHER = "t-other";
const D = "2026-09-10"; // 목요일

const thu = (startTime: string, teacherId: string | null, label: string | null = null): AxisSlot => ({
  dayOfWeek: "thu",
  startTime,
  teacherId,
  slotTeacherLabel: label,
  validFrom: "2026-09-01",
  validTo: null,
});
/** 실례: 중등E_중2 정규 A 9/10 = 16:20 자리 JJ · 17:20 Charlie · 18:20 Charlie (+ 15:20 다른 선생님). */
const MID2A: ScopeClassFacts = {
  homeroomTeacherId: HOMEROOM,
  slots: [thu("16:20:00", null, "JJ"), thu("17:20:00", CHARLIE), thu("18:20:00", CHARLIE), thu("15:20:00", OTHER)],
};
const shareOf = (slotStart: string | null, seatLabel: string | null = null, scope: string | null = CHARLIE) =>
  attendanceSlotShare({
    scopeTeacherId: scope,
    homeroomTeacherId: MID2A.homeroomTeacherId,
    slots: MID2A.slots,
    date: D,
    slotStart,
    seatLabel,
  });

describe("attendanceSlotShare — 몫 · 자리 · 그 밖", () => {
  it("🔴 JJ 교시는 `seat_label`이 없어도 자리다 — 라벨만 보면 실례의 그 행을 놓친다", () => {
    expect(shareOf("16:20")).toBe("seat");
  });

  it("랩실 자리 시수 행(seat_label)은 반 교시 밖 시각·교시 없는 행이어도 자리 · 공백 라벨은 라벨이 아니다", () => {
    expect(shareOf("19:40", "LAB")).toBe("seat");
    expect(shareOf(null, "LAB")).toBe("seat");
    expect(shareOf("17:20", "  ")).toBe("mine");
  });

  it("제 교시는 mine · 다른 선생님 교시는 other · 교시를 안 남긴 기록은 mine(좁히지 않는다)", () => {
    expect(shareOf("17:20")).toBe("mine");
    expect(shareOf("18:20")).toBe("mine");
    expect(shareOf("15:20")).toBe("other");
    expect(shareOf(null)).toBe("mine");
  });

  it("반별 보기(스코프 없음)는 자리도 mine — 반 관점에선 그 반 기록이다(종전 숫자 불변)", () => {
    for (const s of ["16:20", "17:20", "19:40", null]) expect(shareOf(s, null, null), String(s)).toBe("mine");
    expect(shareOf("19:40", "LAB", null)).toBe("mine");
  });

  it("🔴 담임 시작일 이전 칸 — 자리는 그대로 자리, 나머지는 other", () => {
    const before = (slotStart: string | null, seatLabel: string | null = null) =>
      attendanceSlotShare({
        scopeTeacherId: HOMEROOM,
        homeroomTeacherId: HOMEROOM,
        slots: MID2A.slots,
        date: "2026-09-03",
        slotStart,
        homeroomSince: "2026-09-10",
        seatLabel,
      });
    expect(before(null)).toBe("other");
    expect(before("16:20")).toBe("seat");
  });

  /**
   * 🔴 리뷰 2026-09-12: 자리 판정이 **그 시각에 살아 있는 자리 슬롯**에만 걸려 있으면, 슬롯 매칭이 빠지는 순간
   *    `resolveTaughtBy`가 담임 폴백을 타 **mine**이 되어 종전처럼 덮는다. 실제로 빠지는 경우가 셋이다:
   *      ① 자리판 '다른 시간으로 옮기기'(`moveSeatStudentPeriod`)로 그 반에 자리 슬롯이 없는 교시에 찍힌 기록
   *      ② 자리 슬롯이 `valid_to`로 마감된 뒤 날짜의 기록
   *      ③ 교시 시각 정정으로 기록 `slot_start` ≠ 슬롯 `start_time`([[#106]]·[[#126]] 계열)
   *    → 자리 문이 쓰기 때 굳히는 **`recorded_via = "seat"`**를 세 번째 신호로 합집합한다(랩실은 `seat_label`로 이미 막힌다).
   */
  const viaSeat = (slotStart: string | null, scope: string | null = HOMEROOM) =>
    attendanceSlotShare({
      scopeTeacherId: scope,
      homeroomTeacherId: MID2A.homeroomTeacherId,
      slots: MID2A.slots,
      date: D,
      slotStart,
      seatLabel: null,
      recordedVia: "seat",
    });

  it("🔴 자리 문이 남긴 기록(recorded_via=seat)은 슬롯이 안 맞아도 자리 — 담임 폴백으로 mine이 되지 않는다", () => {
    expect(viaSeat("19:40"), "슬롯 없는 교시로 옮긴 자리 기록").toBe("seat");
    expect(viaSeat(null), "교시를 안 남긴 자리 기록").toBe("seat");
    // 🔴 담임이 아닌 **교시 담당** 화면에서도 자리다 — 안 그러면 `other`로 잡혀 지우기에 함께 지워진다.
    expect(viaSeat("15:20", OTHER), "남의 교시 시각에 찍힌 자리 기록").toBe("seat");
  });

  it("🔴 몫 판정도 같은 답 — 화면 값과 저장 대상이 갈리지 않는다", () => {
    expect(
      ownsAttendanceSlot({
        scopeTeacherId: HOMEROOM,
        homeroomTeacherId: MID2A.homeroomTeacherId,
        slots: MID2A.slots,
        date: D,
        slotStart: "19:40",
        recordedVia: "seat",
      }),
    ).toBe(false);
  });

  it("recorded_via가 비었거나 자리 문이 아니면 종전 그대로 — 옛 스키마 폴백 insert는 이 컬럼이 없다(null = 자리 아님)", () => {
    for (const via of [null, undefined, "teacher", "desk", "kiosk"]) {
      expect(
        attendanceSlotShare({
          scopeTeacherId: HOMEROOM,
          homeroomTeacherId: MID2A.homeroomTeacherId,
          slots: MID2A.slots,
          date: D,
          slotStart: "19:40",
          recordedVia: via as never,
        }),
        String(via),
      ).toBe("mine");
    }
  });

  it("반별 보기는 recorded_via와 무관하게 mine — 반의 책은 그 반 전체를 센다(자리 출결을 고칠 유일한 표면)", () => {
    expect(viaSeat("19:40", null)).toBe("mine");
  });

  it("🔴 `mine`은 `ownsAttendanceSlot`과 **같은 답**이다 — 몫 판정을 여기서 새로 짓지 않았다", () => {
    for (const scope of [null, CHARLIE, HOMEROOM, OTHER]) {
      for (const date of ["2026-09-03", D]) {
        for (const since of [null, "2026-09-10"]) {
          for (const slotStart of [null, "15:20", "16:20", "17:20", "19:40"]) {
            for (const seatLabel of [null, "LAB", "  "]) {
              const input = {
                scopeTeacherId: scope,
                homeroomTeacherId: MID2A.homeroomTeacherId,
                slots: MID2A.slots,
                date,
                slotStart,
                homeroomSince: since,
                seatLabel,
              };
              expect(
                attendanceSlotShare(input) === "mine",
                `${scope} ${date} ${since} ${slotStart} ${seatLabel}`,
              ).toBe(ownsAttendanceSlot(input));
            }
          }
        }
      }
    }
  });
});

describe("buildScopeShare — 저장 액션의 판정기(화면과 같은 답)", () => {
  const share = buildScopeShare({ teacherId: CHARLIE, facts: new Map([[CLASS, MID2A]]) });
  const row = (slot_start: string | null, seat_label: string | null = null): DayTargetRow => ({
    id: `r-${slot_start}`,
    slot_start,
    seat_label,
  });

  it("🔴 실례 그대로 — JJ(16:20)는 자리 · Charlie 교시 둘은 mine · 다른 선생님 교시는 other", () => {
    expect(share(CLASS, D, row("16:20:00"))).toBe("seat");
    expect(share(CLASS, D, row("17:20:00"))).toBe("mine");
    expect(share(CLASS, D, row("18:20:00"))).toBe("mine");
    expect(share(CLASS, D, row("15:20:00"))).toBe("other");
  });

  it("축 함수와 같은 답 — 같은 재료(담임 시작일은 저장 판정에 없다)", () => {
    for (const r of [row("16:20:00"), row("17:20:00"), row(null), row("19:40:00", "LAB")]) {
      expect(share(CLASS, D, r), String(r.slot_start)).toBe(
        attendanceSlotShare({
          scopeTeacherId: CHARLIE,
          homeroomTeacherId: MID2A.homeroomTeacherId,
          slots: MID2A.slots,
          date: D,
          slotStart: r.slot_start ?? null,
          homeroomSince: null,
          seatLabel: r.seat_label ?? null,
        }),
      );
    }
  });

  it("재료가 없는 반은 other — 호출부가 `scopeTeaches`로 먼저 거른다", () => {
    expect(share("c-unknown", D, row(null))).toBe("other");
  });
});

describe("splitOutSeatRows — 쓰는 행 / 손대지 않는 자리 행", () => {
  const share = buildScopeShare({ teacherId: CHARLIE, facts: new Map([[CLASS, MID2A]]) });
  const rows: DayTargetRow[] = [
    { id: "r-1820", slot_start: "18:20:00", seat_label: null },
    { id: "r-1720", slot_start: "17:20:00", seat_label: null },
    { id: "r-jj", slot_start: "16:20:00", seat_label: null },
    { id: "r-1520", slot_start: "15:20:00", seat_label: null },
    { id: "r-lab", slot_start: "19:40:00", seat_label: "LAB" },
  ];

  it("🔴 자리(JJ·랩실)만 빠진다 — 다른 선생님 교시 행은 종전대로 쓴다", () => {
    const { write, seat } = splitOutSeatRows(rows, (r) => share(CLASS, D, r) === "seat");
    expect(write.map((r) => r.id)).toEqual(["r-1820", "r-1720", "r-1520"]);
    expect(seat.map((r) => r.id)).toEqual(["r-jj", "r-lab"]);
  });

  it("반별 보기(null)는 전부 쓴다 — 순서까지 그대로(종전과 같은 답)", () => {
    const { write, seat } = splitOutSeatRows(rows, null);
    expect(write).toEqual(rows);
    expect(seat).toEqual([]);
  });
});
