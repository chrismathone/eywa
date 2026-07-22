import { describe, expect, it } from "vitest";
import {
  isCurrentSlot,
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
