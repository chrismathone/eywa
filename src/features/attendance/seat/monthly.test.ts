import { describe, expect, it } from "vitest";
import {
  buildMonthDays,
  classifySeatRecord,
  commonSlotMinutes,
  firstSlotStart,
  formatSeatSchedule,
  isSlotLiveOnDate,
  minutesBetween,
  padDaysTo31,
  sortClassIdsByFirstSlot,
  sumTrackUnits,
  type SeatSlotDef,
} from "./monthly";

const slot = (over: Partial<SeatSlotDef> & Pick<SeatSlotDef, "classId" | "start">): SeatSlotDef => ({
  dayOfWeek: "wed",
  end: "17:00",
  validFrom: "2026-03-01",
  validTo: null,
  ...over,
});

describe("자리 슬롯이 그날 살아 있나", () => {
  it("요일·유효기간이 맞을 때만 산다", () => {
    const s = slot({ classId: "c", start: "16:20", dayOfWeek: "wed", validFrom: "2026-08-01", validTo: "2026-08-20" });
    expect(isSlotLiveOnDate(s, "2026-08-12")).toBe(true); // 수
    expect(isSlotLiveOnDate(s, "2026-08-13")).toBe(false); // 목
    expect(isSlotLiveOnDate(s, "2026-07-29")).toBe(false); // 수지만 유효 전
    expect(isSlotLiveOnDate(s, "2026-08-26")).toBe(false); // 수지만 유효 후
  });
});

describe("기록 갈래 — 확정 vs 확인 필요", () => {
  const live = [slot({ classId: "mec", start: "16:20", dayOfWeek: "wed" })];

  it("자리 라벨이 있으면 시간표가 바뀌어도 확정", () => {
    expect(
      classifySeatRecord(
        { seatLabel: "LAB", classId: "mec", date: "2026-08-12", slotStart: "16:20" },
        [],
        "LAB",
      ),
    ).toBe("confirmed");
    // 별칭도 자리로 본다(시트 옛 값)
    expect(
      classifySeatRecord(
        { seatLabel: "랩실", classId: "mec", date: "2026-08-12", slotStart: "99:00" },
        live,
        "LAB",
      ),
    ).toBe("confirmed");
  });

  it("라벨 없이 그날 산 자리 슬롯과 시각이 같으면 확인 필요", () => {
    expect(
      classifySeatRecord(
        { seatLabel: null, classId: "mec", date: "2026-08-12", slotStart: "16:20:00" },
        live,
        "LAB",
      ),
    ).toBe("review");
  });

  it("라벨 없이 자리 슬롯과 안 맞으면 이 표 밖(담임 정규 기록)", () => {
    expect(
      classifySeatRecord(
        { seatLabel: null, classId: "mec", date: "2026-08-12", slotStart: "14:30" },
        live,
        "LAB",
      ),
    ).toBeNull();
    expect(
      classifySeatRecord(
        { seatLabel: null, classId: "other", date: "2026-08-12", slotStart: "16:20" },
        live,
        "LAB",
      ),
    ).toBeNull();
  });

  it("교시가 없는 옛 기록·다른 자리 라벨은 확인 필요에 안 넣는다", () => {
    expect(
      classifySeatRecord({ seatLabel: null, classId: "mec", date: "2026-08-12", slotStart: null }, live, "LAB"),
    ).toBeNull();
    expect(
      classifySeatRecord({ seatLabel: "JJ", classId: "mec", date: "2026-08-12", slotStart: "16:20" }, live, "LAB"),
    ).toBeNull();
  });

  it("영문 강사 라벨(Jane)은 자리가 아니다", () => {
    expect(
      classifySeatRecord({ seatLabel: "Jane", classId: "mec", date: "2026-08-12", slotStart: "16:20" }, live, "LAB"),
    ).toBeNull();
  });
});

describe("반 정렬 = 첫 랩실 교시 시각", () => {
  it("하루 흐름대로 — 14:20 반이 16:20 반보다 앞", () => {
    const slots = [
      slot({ classId: "lt5", start: "16:20", dayOfWeek: "thu" }),
      slot({ classId: "jp2", start: "14:20", dayOfWeek: "tue" }),
      slot({ classId: "jp2", start: "15:00", dayOfWeek: "wed" }),
    ];
    expect(firstSlotStart(slots, "jp2")).toBe("14:20");
    expect(sortClassIdsByFirstSlot(["lt5", "jp2"], slots)).toEqual(["jp2", "lt5"]);
  });
});

describe("요일·교시 요약", () => {
  it("같은 날 두 교시는 가운데점, 날은 가운데점+공백", () => {
    const slots = [
      slot({ classId: "mec", start: "16:20", end: "17:00", dayOfWeek: "wed" }),
      slot({ classId: "mec", start: "17:00", end: "17:40", dayOfWeek: "wed" }),
      slot({ classId: "mec", start: "16:20", end: "17:00", dayOfWeek: "thu" }),
    ];
    expect(formatSeatSchedule(slots, "mec")).toBe("수 16:20·17:00 · 목 16:20");
  });
});

describe("시수 합 · 슬롯 길이", () => {
  it("소비 상태만 더하고 결석은 빼며 null=1", () => {
    expect(
      sumTrackUnits([
        { status: "present", sessionUnits: null },
        { status: "late", sessionUnits: 1 },
        { status: "absent", sessionUnits: 2 },
        { status: "excused", sessionUnits: 1 },
      ]),
    ).toBe(2);
  });

  it("전 슬롯이 40분이면 40, 섞이면 null", () => {
    expect(minutesBetween("16:20", "17:00")).toBe(40);
    expect(commonSlotMinutes([
      { start: "14:20", end: "15:00" },
      { start: "16:20", end: "17:00" },
    ])).toBe(40);
    expect(commonSlotMinutes([
      { start: "16:20", end: "17:00" },
      { start: "16:20", end: "17:20" },
    ])).toBeNull();
  });
});

describe("날짜축 31칸 패딩", () => {
  it("짧은 달은 뒤를 빈 칸으로 채운다", () => {
    const days = buildMonthDays("2026-02-01", "2026-02-28", "2026-02-10");
    expect(days).toHaveLength(28);
    expect(days[9]?.isToday).toBe(true);
    const padded = padDaysTo31(days);
    expect(padded).toHaveLength(31);
    expect(padded[30]?.placeholder).toBe(true);
  });
});
