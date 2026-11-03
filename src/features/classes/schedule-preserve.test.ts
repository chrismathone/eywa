import { describe, expect, it } from "vitest";
import {
  isCurrentSlot,
  planSlotArchives,
  preserveScheduleFields,
  slotKey,
  type IncomingSlot,
  type PriorSlot,
} from "./schedule-preserve";

const TODAY = "2026-07-22";

const incoming = (over: Partial<IncomingSlot> = {}): IncomingSlot => ({
  dayOfWeek: "mon",
  startTime: "16:00",
  endTime: "17:30",
  teacherId: null,
  classroomId: null,
  ...over,
});
const prior = (over: Partial<PriorSlot> = {}): PriorSlot => ({
  dayOfWeek: "mon",
  // DB는 HH:MM:SS로 돌려준다 — 키가 폼(HH:MM)과 맞아야 승계된다.
  startTime: "16:00:00",
  endTime: "17:30:00",
  validFrom: "2026-03-01",
  validTo: "2026-08-31",
  slotTeacherLabel: "Hannah",
  slotRoomLabel: "LAB실",
  periodLabel: "3교시",
  mergeGroup: "11111111-1111-1111-1111-111111111111",
  ...over,
});
const noPeriod = { validFrom: null, validTo: null, provided: false };

describe("slotKey — DB(HH:MM:SS)와 폼(HH:MM)이 같은 키로 만난다", () => {
  it("초 단위를 잘라 맞춘다", () => {
    expect(slotKey(prior())).toBe(slotKey(incoming()));
  });
});

describe("preserveScheduleFields — 폼이 안 보내는 값을 되살린다", () => {
  it("valid_to·라벨·period_label·merge_group을 승계한다", () => {
    const [row] = preserveScheduleFields({
      incoming: [incoming()],
      prior: [prior()],
      period: noPeriod,
      today: TODAY,
    });
    expect(row!.validTo).toBe("2026-08-31");
    expect(row!.slotTeacherLabel).toBe("Hannah");
    expect(row!.slotRoomLabel).toBe("LAB실");
    expect(row!.periodLabel).toBe("3교시");
    expect(row!.mergeGroup).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("valid_from이 오늘로 리셋되지 않는다", () => {
    const [row] = preserveScheduleFields({
      incoming: [incoming()],
      prior: [prior()],
      period: noPeriod,
      today: TODAY,
    });
    expect(row!.validFrom).toBe("2026-03-01");
  });

  it("승계할 기존 행이 없는 신규 슬롯만 오늘~무기한", () => {
    const [row] = preserveScheduleFields({
      incoming: [incoming({ dayOfWeek: "fri" })],
      prior: [prior()],
      period: noPeriod,
      today: TODAY,
    });
    expect(row!.validFrom).toBe(TODAY);
    expect(row!.validTo).toBeNull();
    expect(row!.slotTeacherLabel).toBeNull();
  });

  it("시작시각이 다른 슬롯은 새 슬롯 취급(엉뚱한 라벨을 옮기지 않는다)", () => {
    const [row] = preserveScheduleFields({
      incoming: [incoming({ startTime: "17:00", endTime: "18:30" })],
      prior: [prior()],
      period: noPeriod,
      today: TODAY,
    });
    expect(row!.slotRoomLabel).toBeNull();
    expect(row!.validFrom).toBe(TODAY);
  });
});

// 🔴 실측 회귀: 클릭그리드는 **교시표의 종료시각**을 제출하는데 저장된 종료시각은 다를 수 있다
// (injaewon 살아있는 45행이 시작 일치·종료 불일치, 전부 slot 라벨 보유 — 예 '중등E_중2 심화' 월
// 16:20~17:20인데 영어 4교시는 16:20~17:00). 정확 키만 보면 그 45행이 매번 라벨을 잃고 수업 길이가
// 60분→40분으로 줄어(= 급여 시수 감소) 버린다.
describe("종료시각이 어긋난 기존 행 — (요일|시작) 2차 짝짓기", () => {
  const gridCell = incoming({ startTime: "16:20", endTime: "17:00" });
  const saved = prior({ startTime: "16:20:00", endTime: "17:20:00" });

  it("라벨·기간을 승계한다", () => {
    const [row] = preserveScheduleFields({
      incoming: [gridCell],
      prior: [saved],
      period: noPeriod,
      today: TODAY,
    });
    expect(row!.slotTeacherLabel).toBe("Hannah");
    expect(row!.slotRoomLabel).toBe("LAB실");
    expect(row!.validFrom).toBe("2026-03-01");
  });

  it("종료시각은 **기존 값**을 지킨다(교시표 값이 시수를 줄이지 않게)", () => {
    const [row] = preserveScheduleFields({
      incoming: [gridCell],
      prior: [saved],
      period: noPeriod,
      today: TODAY,
    });
    expect(row!.endTime).toBe("17:20");
  });

  it("사용자가 직접 입력한 행(explicitTime)은 입력한 종료시각이 이긴다", () => {
    const [row] = preserveScheduleFields({
      incoming: [{ ...gridCell, explicitTime: true }],
      prior: [saved],
      period: noPeriod,
      today: TODAY,
    });
    expect(row!.endTime).toBe("17:00");
    // 라벨 승계는 그대로(같은 요일·시작이므로).
    expect(row!.slotTeacherLabel).toBe("Hannah");
  });

  it("정확히 맞는 기존 행이 따로 있으면 느슨한 짝짓기가 그것을 가로채지 않는다", () => {
    const rows = preserveScheduleFields({
      // 같은 요일·시작의 두 후보(길이만 다름) — 정확 키가 있는 쪽이 먼저 짝을 가져가야 한다.
      incoming: [incoming({ startTime: "16:20", endTime: "17:00" }), incoming({ startTime: "16:20", endTime: "17:20" })],
      prior: [saved, prior({ startTime: "16:20:00", endTime: "17:00:00", slotRoomLabel: "정확" })],
      period: noPeriod,
      today: TODAY,
    });
    expect(rows[0]!.slotRoomLabel).toBe("정확");
    expect(rows[1]!.slotRoomLabel).toBe("LAB실");
  });
});

describe("isCurrentSlot — 폼이 편집하는 범위", () => {
  it("종료일이 없으면(무기한) 현재 행", () => {
    expect(isCurrentSlot(null, TODAY)).toBe(true);
  });
  it("오늘 이후 종료면 현재 행", () => {
    expect(isCurrentSlot("2026-08-20", TODAY)).toBe(true);
    expect(isCurrentSlot(TODAY, TODAY)).toBe(true);
  });
  it("이미 지난 종료일은 이력(폼이 건드리지 않는다)", () => {
    expect(isCurrentSlot("2026-07-02", TODAY)).toBe(false);
  });

  it("같은 키가 여러 행이면 1:1로 하나씩만 소비한다", () => {
    const rows = preserveScheduleFields({
      incoming: [incoming(), incoming()],
      prior: [prior({ slotRoomLabel: "A" }), prior({ slotRoomLabel: "B" })],
      period: noPeriod,
      today: TODAY,
    });
    expect(rows.map((r) => r.slotRoomLabel)).toEqual(["A", "B"]);
  });

  it("teacher_id·classroom_id(폼이 보내는 값)는 그대로 통과", () => {
    const [row] = preserveScheduleFields({
      incoming: [incoming({ teacherId: "t-9", classroomId: "r-9" })],
      prior: [prior()],
      period: noPeriod,
      today: TODAY,
    });
    expect(row!.teacherId).toBe("t-9");
    expect(row!.classroomId).toBe("r-9");
  });
});

describe("운영 기간(periodProvided) — 특강 만료", () => {
  it("기간을 주면 전 행에 적용된다", () => {
    const rows = preserveScheduleFields({
      incoming: [incoming(), incoming({ dayOfWeek: "fri" })],
      prior: [prior()],
      period: { validFrom: "2026-07-25", validTo: "2026-08-20", provided: true },
      today: TODAY,
    });
    expect(rows.map((r) => r.validFrom)).toEqual(["2026-07-25", "2026-07-25"]);
    expect(rows.map((r) => r.validTo)).toEqual(["2026-08-20", "2026-08-20"]);
  });

  it("provided=true + 종료일 비움 = 명시적 무기한(되돌리기)", () => {
    const [row] = preserveScheduleFields({
      incoming: [incoming()],
      prior: [prior()],
      period: { validFrom: null, validTo: null, provided: true },
      today: TODAY,
    });
    expect(row!.validTo).toBeNull();
    // 시작일은 비워도 기존값 보존(시작일을 '안 정함'으로 읽는다).
    expect(row!.validFrom).toBe("2026-03-01");
  });

  it("provided=false(기간 UI 없는 폼)는 기존 종료일을 지우지 않는다", () => {
    const [row] = preserveScheduleFields({
      incoming: [incoming()],
      prior: [prior()],
      period: { validFrom: null, validTo: null, provided: false },
      today: TODAY,
    });
    expect(row!.validTo).toBe("2026-08-31");
  });

  // 교시마다 종료일이 갈리면 폼이 칸을 비워 프리필한다. 그때 빈 칸을 "무기한으로 되돌리기"로 읽으면
  // 아무것도 안 바꾸고 저장만 해도 교시별 종료일이 한 번에 지워진다 → keepValidTo로 "안 정함"으로 읽는다.
  it("keepValidTo + 빈 종료일 = 교시별 기존 종료일 유지", () => {
    const rows = preserveScheduleFields({
      incoming: [incoming(), incoming({ dayOfWeek: "fri" })],
      prior: [prior(), prior({ dayOfWeek: "fri", validTo: "2026-12-31" })],
      period: { validFrom: null, validTo: null, provided: true, keepValidTo: true },
      today: TODAY,
    });
    expect(rows.map((r) => r.validTo)).toEqual(["2026-08-31", "2026-12-31"]);
  });

  it("keepValidTo여도 날짜를 넣으면 전 행이 그 날짜로 통일된다(폼 안내와 일치)", () => {
    const rows = preserveScheduleFields({
      incoming: [incoming(), incoming({ dayOfWeek: "fri" })],
      prior: [prior(), prior({ dayOfWeek: "fri", validTo: "2026-12-31" })],
      period: { validFrom: null, validTo: "2026-09-30", provided: true, keepValidTo: true },
      today: TODAY,
    });
    expect(rows.map((r) => r.validTo)).toEqual(["2026-09-30", "2026-09-30"]);
  });

  it("기존 행이 없어도 지정 기간이 그대로 들어간다(신규 특강)", () => {
    const [row] = preserveScheduleFields({
      incoming: [incoming()],
      prior: [],
      period: { validFrom: "2026-12-20", validTo: "2027-01-20", provided: true },
      today: TODAY,
    });
    expect(row!.validFrom).toBe("2026-12-20");
    expect(row!.validTo).toBe("2027-01-20");
  });
});

describe("planSlotArchives — 담당·강의실 변경 이력(원장 2026-08-04)", () => {
  const base = {
    dayOfWeek: "mon",
    startTime: "16:00",
    endTime: "17:00",
    validFrom: "2026-01-01",
    validTo: null,
    slotTeacherLabel: null,
    slotRoomLabel: null,
    periodLabel: null,
    mergeGroup: null,
  };

  it("담당이 바뀌면 옛 배치를 어제까지로 마감한다", () => {
    const archives = planSlotArchives({
      incoming: [{ dayOfWeek: "mon", startTime: "16:00", endTime: "17:00", teacherId: "new", classroomId: null }],
      prior: [{ ...base, teacherId: "old", classroomId: null }],
      today: "2026-08-04",
    });
    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatchObject({ teacherId: "old", validFrom: "2026-01-01", validTo: "2026-08-03" });
  });

  it("강의실이 바뀌어도 마감 행을 남긴다", () => {
    const archives = planSlotArchives({
      incoming: [{ dayOfWeek: "mon", startTime: "16:00", endTime: "17:00", teacherId: "t", classroomId: "r2" }],
      prior: [{ ...base, teacherId: "t", classroomId: "r1" }],
      today: "2026-08-04",
    });
    expect(archives[0]).toMatchObject({ classroomId: "r1", validTo: "2026-08-03" });
  });

  it("바뀐 게 없으면 마감 행을 만들지 않는다(행이 무한히 불어나지 않게)", () => {
    const archives = planSlotArchives({
      incoming: [{ dayOfWeek: "mon", startTime: "16:00", endTime: "17:00", teacherId: "t", classroomId: "r1" }],
      prior: [{ ...base, teacherId: "t", classroomId: "r1" }],
      today: "2026-08-04",
    });
    expect(archives).toEqual([]);
  });

  it("사라진 슬롯도 어제까지로 마감한다(지웠다고 과거까지 없던 일이 되면 안 된다)", () => {
    const archives = planSlotArchives({
      incoming: [],
      prior: [{ ...base, teacherId: "t", classroomId: "r1" }],
      today: "2026-08-04",
    });
    expect(archives[0]).toMatchObject({ validTo: "2026-08-03" });
  });

  it("🔴 오늘 시작한 행은 마감하지 않는다 — 거꾸로 된 구간·쓰레기 행 방지", () => {
    const archives = planSlotArchives({
      incoming: [{ dayOfWeek: "mon", startTime: "16:00", endTime: "17:00", teacherId: "new", classroomId: null }],
      prior: [{ ...base, validFrom: "2026-08-04", teacherId: "old", classroomId: null }],
      today: "2026-08-04",
    });
    expect(archives).toEqual([]);
  });

  it("마감 행과 새 행의 구간이 맞물린다(구멍·중복 없이)", () => {
    const incoming = [
      { dayOfWeek: "mon", startTime: "16:00", endTime: "17:00", teacherId: "new", classroomId: null },
    ];
    const prior = [{ ...base, teacherId: "old", classroomId: null }];
    const archives = planSlotArchives({ incoming, prior, today: "2026-08-04" });
    const rows = preserveScheduleFields({
      incoming,
      prior,
      period: { validFrom: null, validTo: null, provided: false },
      today: "2026-08-04",
    });
    expect(archives[0]!.validTo).toBe("2026-08-03");
    expect(rows[0]!.validFrom).toBe("2026-08-04"); // 어제까지 옛 담당 / 오늘부터 새 담당
  });

  it("안 바뀐 슬롯의 시작일은 그대로 승계한다(불필요한 구간 분할 금지)", () => {
    const rows = preserveScheduleFields({
      incoming: [{ dayOfWeek: "mon", startTime: "16:00", endTime: "17:00", teacherId: "t", classroomId: "r1" }],
      prior: [{ ...base, teacherId: "t", classroomId: "r1" }],
      period: { validFrom: null, validTo: null, provided: false },
      today: "2026-08-04",
    });
    expect(rows[0]!.validFrom).toBe("2026-01-01");
  });
});

// ── 자리(LAB·JJ) 라벨 (원장 2026-08-04 "스케줄 배치에서 JJ 또는 LAB 배치가 가능하도록") ──────────
describe("자리 라벨", () => {
  const prior = (label: string | null) => [
    {
      dayOfWeek: "mon",
      startTime: "14:20",
      endTime: "15:00",
      teacherId: null,
      classroomId: null,
      validFrom: "2026-07-03",
      validTo: null,
      slotTeacherLabel: label,
      slotRoomLabel: null,
      periodLabel: null,
      mergeGroup: null,
    },
  ];
  const incoming = (seatLabel?: string | null, teacherId: string | null = null) => [
    { dayOfWeek: "mon", startTime: "14:20", endTime: "15:00", teacherId, classroomId: null, ...(seatLabel !== undefined ? { seatLabel } : {}) },
  ];
  const run = (inc: ReturnType<typeof incoming>, pri: ReturnType<typeof prior>) =>
    preserveScheduleFields({ incoming: inc, prior: pri, period: { validFrom: null, validTo: null, provided: false }, today: "2026-08-04" })[0]!;

  it("자리를 고르면 그 자리가 라벨이 된다", () => {
    expect(run(incoming("LAB"), prior(null)).slotTeacherLabel).toBe("LAB");
  });

  it("🔴 시트가 넣은 강사 닉네임 라벨은 폼 저장에 안 지워진다(492행 보호)", () => {
    expect(run(incoming(), prior("Anna")).slotTeacherLabel).toBe("Anna");
  });

  it("자리였다가 사람으로 바꾸면 라벨은 지워진다(유령 방지)", () => {
    expect(run(incoming(null, "user-1"), prior("LAB")).slotTeacherLabel).toBeNull();
  });

  it("자리를 그대로 다시 보내면 유지된다", () => {
    expect(run(incoming("JJ"), prior("JJ")).slotTeacherLabel).toBe("JJ");
  });
});

/**
 * 🔴 실사고 재현(원장 2026-08-13 *"중등E_초등 브릿지 C2는 스케줄 수정 자체가 안 되네. 수업목록에서
 * 수업수정 눌러서 스케줄 수정 후 저장했는데 자꾸 원복이 되네"*).
 *
 * 영어 평일 교시표엔 **시작시각이 같은 교시가 둘**이다 — EiE 4교시(16:20~17:00) · IJW 1교시(16:20~17:20).
 * C2 실데이터: 월·목은 IJW 1교시인데 화요일만 EiE 4교시였다. 화요일을 IJW 1교시로 옮기면
 * `요일|시작`이 같아 짝이 지어지고, 옛 규칙("종료시각은 기존 행이 이긴다")이 17:00으로 되돌려
 * **저장이 아무 일도 안 했다**(실측: 그날 C2에 마감 행 0·신규 구간 0·감사로그 0).
 */
describe("🔴 같은 시작시각의 다른 교시로 이동(EiE 4교시 ↔ IJW 1교시)", () => {
  const PAIRS = {
    weekday: new Set([
      "16:20|17:00", // EiE 4교시
      "16:20|17:20", // IJW 1교시
      "17:20|18:10", // IJW 2교시
    ]),
    weekend: new Set<string>(),
  };
  const prior = {
    dayOfWeek: "tue",
    startTime: "16:20",
    endTime: "17:00", // EiE 4교시
    validFrom: "2026-07-03",
    validTo: null,
    teacherId: "t1",
    classroomId: "r1",
    slotTeacherLabel: "Sam",
    slotRoomLabel: "본원604",
    periodLabel: null,
    mergeGroup: null,
  };
  // 그리드가 IJW 1교시 칸으로 옮겨 제출한 값(클릭그리드라 explicitTime=false).
  const incoming = [
    { dayOfWeek: "tue", startTime: "16:20", endTime: "17:20", teacherId: "t1", classroomId: "r1" },
  ];

  it("교시표를 아는 경우 폼이 고른 교시로 저장된다(원복 안 됨)", () => {
    const rows = preserveScheduleFields({
      incoming,
      prior: [prior],
      period: { validFrom: null, validTo: null, provided: false },
      today: "2026-08-13",
      periodPairs: PAIRS,
    });
    expect(rows[0]!.endTime).toBe("17:20");
    // 배치가 바뀌었으니 새 구간은 오늘부터(이력 규약).
    expect(rows[0]!.validFrom).toBe("2026-08-13");
    // 라벨·강의실 라벨은 그대로 승계된다(폼이 안 보내는 값).
    expect(rows[0]!.slotTeacherLabel).toBe("Sam");
    expect(rows[0]!.slotRoomLabel).toBe("본원604");
  });

  it("옛 배치는 어제까지로 마감된다 — 값만 바뀌고 이력이 비는 일이 없게", () => {
    const archives = planSlotArchives({
      incoming,
      prior: [prior],
      today: "2026-08-13",
      periodPairs: PAIRS,
    });
    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatchObject({ endTime: "17:00", validTo: "2026-08-12" });
  });

  it("반대 방향(IJW 1교시 → EiE 4교시)도 같다", () => {
    const rows = preserveScheduleFields({
      incoming: [{ dayOfWeek: "tue", startTime: "16:20", endTime: "17:00", teacherId: "t1", classroomId: "r1" }],
      prior: [{ ...prior, endTime: "17:20" }],
      period: { validFrom: null, validTo: null, provided: false },
      today: "2026-08-13",
      periodPairs: PAIRS,
    });
    expect(rows[0]!.endTime).toBe("17:00");
  });

  it("🔴 교시표 밖 시각(레거시 16:20~17:10)은 여전히 기존 행이 이긴다 — 급여 시수가 조용히 줄면 안 된다", () => {
    const rows = preserveScheduleFields({
      incoming, // 그리드가 시작시각 폴백으로만 그린 칸 = 종료시각은 추측
      prior: [{ ...prior, endTime: "17:10" }],
      period: { validFrom: null, validTo: null, provided: false },
      today: "2026-08-13",
      periodPairs: PAIRS,
    });
    expect(rows[0]!.endTime).toBe("17:10");
  });

  it("교시표를 안 넘기면 예전 동작(기존 행 우선) — 모르는 호출부가 시수를 자르지 않게", () => {
    const rows = preserveScheduleFields({
      incoming,
      prior: [prior],
      period: { validFrom: null, validTo: null, provided: false },
      today: "2026-08-13",
    });
    expect(rows[0]!.endTime).toBe("17:00");
  });

  it("자유 시각 행(explicitTime)은 교시표와 무관하게 폼 값이 이긴다", () => {
    const rows = preserveScheduleFields({
      incoming: [{ ...incoming[0], endTime: "17:35", explicitTime: true }],
      prior: [prior],
      period: { validFrom: null, validTo: null, provided: false },
      today: "2026-08-13",
      periodPairs: PAIRS,
    });
    expect(rows[0]!.endTime).toBe("17:35");
  });
});

describe("강의실 라벨 — 강의실을 바꾸면 라벨도 새 강의실로(원장 2026-11-02 PL3a: 설정 605 · 시간표 602)", () => {
  const rooms = new Map([["r-605", "본원605"], ["r-602", "본원602"]]);
  const run = (inc: Partial<IncomingSlot>, pr: Partial<PriorSlot> | null) =>
    preserveScheduleFields({
      incoming: [incoming(inc)],
      prior: pr ? [prior(pr)] : [],
      period: noPeriod,
      today: TODAY,
      roomNames: rooms,
    })[0]!.slotRoomLabel;
  it("강의실을 바꾸면 옛 라벨을 버리고 새 강의실 이름", () => {
    expect(run({ classroomId: "r-605" }, { classroomId: "r-602", slotRoomLabel: "본원602" })).toBe("본원605");
  });
  it("강의실이 그대로면 라벨(시트 원문 포함)을 승계", () => {
    expect(run({ classroomId: "r-602" }, { classroomId: "r-602", slotRoomLabel: "602" })).toBe("602");
    expect(run({ classroomId: null }, { classroomId: null, slotRoomLabel: "605" })).toBe("605");
  });
  it("강의실을 비우면 라벨도 비운다(옛 강의실이 시간표에 남지 않게)", () => {
    expect(run({ classroomId: null }, { classroomId: "r-602", slotRoomLabel: "본원602" })).toBeNull();
  });
  it("새 교시는 고른 강의실 이름 · 이름을 모르면 비운다", () => {
    expect(run({ classroomId: "r-605" }, null)).toBe("본원605");
    expect(run({ classroomId: "r-999" }, { classroomId: "r-602", slotRoomLabel: "본원602" })).toBeNull();
  });
});
