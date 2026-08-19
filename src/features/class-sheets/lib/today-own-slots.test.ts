import { describe, expect, it } from "vitest";
import { firstVisibleTodaySlot, selectSheetDays, slotsWithRecordsOn } from "./today-own-slots";
import type { GridDay, GridPlanLine, GridSlot } from "./grid";

/**
 * 원장 2026-08-19: **"오늘 시트에서는 본인 수업만 보이고, 주간 시트는 여전히 지금처럼."**
 *
 * 그래서 이 가드는 **동작**을 잠근다(문자열 존재 확인이 아니다 — 그런 가드는 반대로 동작해도 통과한다):
 *  ① 같은 하루를 `variant:"full"`로 주면 남의 교시가 **그대로 남는다**(주간 시트 회귀 방지).
 *  ② `variant:"today"`면 남의 교시만 빠지고, 자리(JJ·LAB)·담당 미지정·기록 보유 교시는 남는다.
 *  ③ 판정은 `teacher_id` FK뿐 — 표시 라벨이 남을 가리켜도 그것으로 숨기거나 살리지 않는다.
 */
const DATE = "2026-08-19";
const ME = "teacher-me";
const OTHER = "teacher-other";

function slot(over: Partial<GridSlot> & { slotStart: string }): GridSlot {
  return {
    slotEnd: null,
    scheduled: true,
    teacherId: null,
    teacherLabel: null,
    roomLabel: null,
    lines: [],
    roster: [],
    ...over,
  };
}

function dayOf(slots: GridSlot[], date = DATE): GridDay {
  return { date, dow: "wed", slots };
}

const SLOTS: GridSlot[] = [
  slot({ slotStart: "14:20", teacherId: OTHER, teacherLabel: "KRISTINE DRIVER" }),
  slot({ slotStart: "15:20", teacherId: ME, teacherLabel: "추민아" }),
  slot({ slotStart: "16:20", teacherId: null, teacherLabel: "JJ" }), // 자리
  slot({ slotStart: "17:20", teacherId: null, teacherLabel: null }), // 담당 미지정(모호)
];

const day = dayOf(SLOTS);
const otherDay: GridDay = { date: "2026-08-20", dow: "thu", slots: [slot({ slotStart: "14:20" })] };

const startsOf = (slots: readonly GridSlot[]) => slots.map((s) => s.slotStart);

describe("오늘 면만 내 교시로 좁힌다 — 주간 시트는 불변", () => {
  it("🔴 variant 'full'은 남의 교시를 그대로 남긴다(요일 필터만 적용)", () => {
    const r = selectSheetDays({
      variant: "full",
      days: [day, otherDay],
      dayFilter: DATE,
      myTeacherId: ME,
    });
    expect(r.days).toHaveLength(1);
    expect(startsOf(r.days[0]!.slots)).toEqual(["14:20", "15:20", "16:20", "17:20"]);
    expect(r.todayDay).toBeNull();
    expect(r.hiddenOwn).toEqual([]);
  });

  it("🔴 variant 'full'은 요일 필터가 없으면 주 전체를 그대로 돌려준다", () => {
    const r = selectSheetDays({
      variant: "full",
      days: [day, otherDay],
      dayFilter: null,
      myTeacherId: ME,
    });
    expect(r.days.map((d) => d.date)).toEqual([DATE, "2026-08-20"]);
    expect(startsOf(r.days[0]!.slots)).toHaveLength(4);
  });

  it("variant 'today'는 명확히 남의 교시만 뺀다 — 자리·미지정·내 교시는 남는다", () => {
    const r = selectSheetDays({
      variant: "today",
      days: [day],
      dayFilter: DATE,
      myTeacherId: ME,
    });
    expect(startsOf(r.todayDay!.slots)).toEqual(["15:20", "16:20", "17:20"]);
    expect(r.hiddenOwn).toEqual([{ slotStart: "14:20", teacherId: OTHER }]);
  });

  it("🔴 오늘 면에서 걸러도 `days`(주간용 배열)와 입력 하루는 원본 슬롯을 그대로 들고 있다", () => {
    const r = selectSheetDays({
      variant: "today",
      days: [day],
      dayFilter: DATE,
      myTeacherId: ME,
    });
    expect(startsOf(r.days[0]!.slots)).toEqual(["14:20", "15:20", "16:20", "17:20"]);
    expect(day.slots).toHaveLength(4); // 입력 배열을 제자리에서 고치지 않는다
  });

  it("숨길 게 없으면 **같은 객체**를 돌려준다(memo된 표가 헛되게 다시 그려지지 않게)", () => {
    const mine = dayOf([SLOTS[1]!]);
    const r = selectSheetDays({ variant: "today", days: [mine], dayFilter: DATE, myTeacherId: ME });
    expect(r.todayDay).toBe(mine);
  });

  it("🔴 임시 위임으로 대신 맡은 반은 거르지 않는다(오늘 그 반은 통째로 내 수업)", () => {
    const r = selectSheetDays({
      variant: "today",
      days: [day],
      dayFilter: DATE,
      myTeacherId: ME,
      delegatedClass: true,
    });
    expect(r.todayDay).toBe(day);
    expect(startsOf(r.todayDay!.slots)).toEqual(["14:20", "15:20", "16:20", "17:20"]);
    expect(r.hiddenOwn).toEqual([]);
  });

  it("강사 스코프가 없으면(사무실) 아무것도 숨기지 않는다", () => {
    const r = selectSheetDays({
      variant: "today",
      days: [day],
      dayFilter: DATE,
      myTeacherId: null,
    });
    expect(r.todayDay).toBe(day);
    expect(r.hiddenOwn).toEqual([]);
  });

  it("🔴 표시 라벨이 남을 가리켜도 FK가 나면 남긴다(판정은 teacher_id뿐)", () => {
    const r = selectSheetDays({
      variant: "today",
      days: [dayOf([slot({ slotStart: "14:20", teacherId: ME, teacherLabel: "KRISTINE DRIVER" })])],
      dayFilter: DATE,
      myTeacherId: ME,
    });
    expect(startsOf(r.todayDay!.slots)).toEqual(["14:20"]);
    expect(r.hiddenOwn).toEqual([]);
  });

  it("🔴 자리 라벨에 FK가 어긋나게 붙어 있어도 자리는 남는다(JJ·LAB은 떠도 된다)", () => {
    const r = selectSheetDays({
      variant: "today",
      days: [
        dayOf([
          slot({ slotStart: "14:20", teacherId: OTHER, teacherLabel: "LAB" }),
          slot({ slotStart: "15:20", teacherId: OTHER, teacherLabel: "집중자율수업실" }),
        ]),
      ],
      dayFilter: DATE,
      myTeacherId: ME,
    });
    expect(startsOf(r.todayDay!.slots)).toEqual(["14:20", "15:20"]);
    expect(r.hiddenOwn).toEqual([]);
  });

  it("그 날짜의 하루만 고른다 — 요일 필터가 다른 날짜면 오늘 면은 비어 있다", () => {
    const r = selectSheetDays({
      variant: "today",
      days: [otherDay],
      dayFilter: DATE,
      myTeacherId: ME,
    });
    expect(r.todayDay).toBeNull();
    expect(r.hiddenOwn).toEqual([]);
  });
});

describe("🔴 기록이 있는 교시는 숨기지 않는다 — 조용한 실종 금지", () => {
  const onlyOther = dayOf([
    slot({ slotStart: "14:20", teacherId: OTHER, teacherLabel: "KRISTINE DRIVER" }),
  ]);

  it("기록이 없으면 숨긴다(기준선)", () => {
    const r = selectSheetDays({
      variant: "today",
      days: [onlyOther],
      dayFilter: DATE,
      myTeacherId: ME,
    });
    expect(r.todayDay!.slots).toEqual([]);
    expect(r.hiddenOwn).toHaveLength(1);
  });

  it("출결(옛 'slot_start=null' 행이 붙은 첫 교시 포함)이 있으면 남긴다", () => {
    const r = selectSheetDays({
      variant: "today",
      days: [onlyOther],
      dayFilter: DATE,
      myTeacherId: ME,
      // 서버(queries.ts firstSlotByDate)가 옛 행을 그 날 **첫 교시** 칸 키로 바꿔 내려보낸다.
      slotsWithRecords: () => slotsWithRecordsOn(DATE, [`stu-1|${DATE}|14:20`]),
    });
    expect(startsOf(r.todayDay!.slots)).toEqual(["14:20"]);
    expect(r.hiddenOwn).toEqual([]);
  });

  it("교시 메모만 있어도 남긴다", () => {
    const r = selectSheetDays({
      variant: "today",
      days: [onlyOther],
      dayFilter: DATE,
      myTeacherId: ME,
      slotsWithRecords: () => slotsWithRecordsOn(DATE, [], [`slot:${DATE}:14:20`]),
    });
    expect(startsOf(r.todayDay!.slots)).toEqual(["14:20"]);
  });

  it("계획 줄이 있어도 남긴다(슬롯이 직접 들고 있는 값)", () => {
    const r = selectSheetDays({
      variant: "today",
      days: [
        dayOf([
          slot({
            slotStart: "14:20",
            teacherId: OTHER,
            teacherLabel: "KRISTINE DRIVER",
            lines: [{} as GridPlanLine],
          }),
        ]),
      ],
      dayFilter: DATE,
      myTeacherId: ME,
    });
    expect(startsOf(r.todayDay!.slots)).toEqual(["14:20"]);
  });

  it("기록 집합은 **그 날짜**만 본다 — 다른 날짜의 같은 시각은 근거가 아니다", () => {
    const set = slotsWithRecordsOn(
      DATE,
      [`stu-1|2026-08-20|14:20`, `stu-2|${DATE}|16:20`],
      [`slot:2026-08-20:15:20`],
    );
    expect([...set]).toEqual(["16:20"]);
  });

  it("교시 모양이 아닌 키는 무시한다(옛 '그날 전체'가 빈 칸으로 떨어진 키 등)", () => {
    expect([...slotsWithRecordsOn(DATE, [`stu-1|${DATE}|`, `stu-2|${DATE}|없음`])]).toEqual([]);
  });
});

/**
 * 오늘 면 **반 순서**의 정렬 키 — 원장 제보 2026-08-19 *"시간대가 순서대로 배치가 안되어있다"*.
 * 서버 카드의 `startsAt`은 **남의 교시까지 포함한** 그 날 첫 시각이라, 15:00을 남이 맡고 내가 15:40만
 * 맡은 반이 15:00짜리 반보다 위에 왔다. 정렬은 **화면에 보이는 첫 교시**로 해야 일과 순서가 된다.
 */
describe("정렬 키 — 보이는 첫 교시", () => {
  const dataOf = (slots: GridSlot[]) => ({
    grid: { days: [dayOf(slots)] },
    delegated: false,
    attendanceByStudentDate: {},
    marks: {},
    memos: {},
  });

  it("남의 교시가 더 이르면 그 시각이 아니라 **내 첫 교시**를 돌려준다", () => {
    const data = dataOf([
      slot({ slotStart: "15:00", teacherId: OTHER, teacherLabel: "육소희" }),
      slot({ slotStart: "15:40", teacherId: ME, teacherLabel: "이다교" }),
    ]);
    expect(firstVisibleTodaySlot(data, { date: DATE, myTeacherId: ME })).toBe("15:40");
  });

  it("기록이 남은 남의 교시는 화면에 남으므로 정렬 키도 그 시각이다(화면과 같은 판정)", () => {
    const data = {
      ...dataOf([
        slot({ slotStart: "15:00", teacherId: OTHER, teacherLabel: "육소희" }),
        slot({ slotStart: "15:40", teacherId: ME, teacherLabel: "이다교" }),
      ]),
      attendanceByStudentDate: { [`stu-1|${DATE}|15:00`]: {} },
    };
    expect(firstVisibleTodaySlot(data, { date: DATE, myTeacherId: ME })).toBe("15:00");
  });

  it("스코프가 없으면(사무실) 아무것도 안 숨기므로 그 날 첫 교시", () => {
    const data = dataOf([
      slot({ slotStart: "15:00", teacherId: OTHER }),
      slot({ slotStart: "15:40", teacherId: ME }),
    ]);
    expect(firstVisibleTodaySlot(data, { date: DATE, myTeacherId: null })).toBe("15:00");
  });

  it("그릴 교시가 하나도 없으면 null(호출부가 맨 뒤로 보낸다)", () => {
    const data = dataOf([slot({ slotStart: "15:00", teacherId: OTHER })]);
    expect(firstVisibleTodaySlot(data, { date: DATE, myTeacherId: ME })).toBeNull();
  });
});
