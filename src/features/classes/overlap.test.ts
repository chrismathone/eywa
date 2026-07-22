import { describe, expect, it } from "vitest";
import {
  dateRangesOverlap,
  findOverlaps,
  isLiveSlot,
  overlapItemLabel,
  overlapSummary,
  timeRangesOverlap,
  type ExistingSlot,
  type OverlapCandidate,
} from "./overlap";

const TODAY = "2026-07-22";

function existing(over: Partial<ExistingSlot> = {}): ExistingSlot {
  return {
    classId: "c-old",
    className: "중2 수학A",
    dayOfWeek: "mon",
    startTime: "16:00:00",
    endTime: "17:30:00",
    validFrom: "2026-03-01",
    validTo: null,
    teacherId: "t-1",
    teacherName: "김강사",
    classroomId: "r-1",
    roomName: "본원303",
    isActive: true,
    closedAt: null,
    ...over,
  };
}
function candidate(over: Partial<OverlapCandidate> = {}): OverlapCandidate {
  return {
    dayOfWeek: "mon",
    startTime: "16:30",
    endTime: "18:00",
    validFrom: null,
    validTo: null,
    teacherId: "t-1",
    classroomId: "r-1",
    ...over,
  };
}
const run = (c: OverlapCandidate[], e: ExistingSlot[], excludeClassId?: string) =>
  findOverlaps({ candidates: c, existing: e, today: TODAY, ...(excludeClassId ? { excludeClassId } : {}) });

describe("timeRangesOverlap", () => {
  it("부분 겹침·포함은 겹침", () => {
    expect(timeRangesOverlap("16:30", "18:00", "16:00", "17:30")).toBe(true);
    expect(timeRangesOverlap("16:10", "16:20", "16:00", "17:30")).toBe(true);
  });
  it("경계 접촉(앞 끝 == 뒤 시작)은 겹침이 아니다", () => {
    expect(timeRangesOverlap("17:30", "19:00", "16:00", "17:30")).toBe(false);
    expect(timeRangesOverlap("14:00", "16:00", "16:00", "17:30")).toBe(false);
  });
  it("HH:MM:SS(DB 형식)도 같게 본다", () => {
    expect(timeRangesOverlap("16:30", "18:00", "16:00:00", "17:30:00")).toBe(true);
  });
});

describe("dateRangesOverlap — 기간이 안 겹치면 충돌이 아니다", () => {
  it("여름 특강 vs 겨울 특강 = 안 겹침", () => {
    expect(dateRangesOverlap("2026-07-20", "2026-08-20", "2026-12-20", "2027-01-20")).toBe(false);
  });
  it("하루라도 겹치면 겹침", () => {
    expect(dateRangesOverlap("2026-07-20", "2026-08-20", "2026-08-20", "2026-09-01")).toBe(true);
  });
  it("null=무기한", () => {
    expect(dateRangesOverlap(null, null, "2026-12-20", "2027-01-20")).toBe(true);
    expect(dateRangesOverlap("2026-07-20", null, null, "2026-07-01")).toBe(false);
  });
});

describe("isLiveSlot — 폐지·종강·만료 제외", () => {
  it("폐지 반 제외", () => {
    expect(isLiveSlot({ isActive: false, closedAt: null, validTo: null }, TODAY)).toBe(false);
  });
  it("종강(closed_at<오늘) 제외, 오늘 이후 종강은 살아있다", () => {
    expect(isLiveSlot({ isActive: true, closedAt: "2026-07-21", validTo: null }, TODAY)).toBe(false);
    expect(isLiveSlot({ isActive: true, closedAt: "2026-08-31", validTo: null }, TODAY)).toBe(true);
  });
  it("만료(valid_to<오늘) 제외", () => {
    expect(isLiveSlot({ isActive: true, closedAt: null, validTo: "2026-06-30" }, TODAY)).toBe(false);
  });
});

describe("findOverlaps — 전부 찾고, 막지 않는다", () => {
  it("강의실·강사가 동시에 겹치면 2건(원인이 다르다)", () => {
    const items = run([candidate()], [existing()]);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.kind).sort()).toEqual(["classroom", "teacher"]);
    expect(items[0]!.className).toBe("중2 수학A");
    expect(items[0]!.dayLabel).toBe("월");
    expect(items[0]!.startTime).toBe("16:00");
    expect(items[0]!.endTime).toBe("17:30");
  });

  it("첫 건에서 멈추지 않고 여러 반을 모두 낸다", () => {
    const items = run(
      [candidate()],
      [
        existing(),
        existing({ classId: "c-2", className: "중3 영어B", teacherId: null, teacherName: null }),
        existing({ classId: "c-3", className: "고1 수학", classroomId: null, roomName: null }),
      ],
    );
    expect(new Set(items.map((i) => i.classId))).toEqual(new Set(["c-old", "c-2", "c-3"]));
    expect(items.filter((i) => i.kind === "classroom")).toHaveLength(2);
    expect(items.filter((i) => i.kind === "teacher")).toHaveLength(2);
  });

  it("폐지·종강·만료 반은 겹침이 아니다(빈 교실 거짓경고 방지)", () => {
    expect(run([candidate()], [existing({ isActive: false })])).toHaveLength(0);
    expect(run([candidate()], [existing({ closedAt: "2026-07-01" })])).toHaveLength(0);
    expect(run([candidate()], [existing({ validTo: "2026-07-01" })])).toHaveLength(0);
  });

  it("기간이 안 겹치면 같은 교실·같은 시각이어도 겹침이 아니다", () => {
    const winter = candidate({ validFrom: "2026-12-20", validTo: "2027-01-20" });
    const summer = existing({ validFrom: "2026-07-20", validTo: "2026-08-20" });
    expect(run([winter], [summer])).toHaveLength(0);
  });

  it("자기 자신(수정 시)은 제외", () => {
    expect(run([candidate()], [existing()], "c-old")).toHaveLength(0);
  });

  it("요일이 다르거나 시간이 안 겹치면 무시", () => {
    expect(run([candidate({ dayOfWeek: "tue" })], [existing()])).toHaveLength(0);
    expect(run([candidate({ startTime: "17:30", endTime: "19:00" })], [existing()])).toHaveLength(0);
  });

  it("강의실·강사 둘 다 없는 후보는 비교 대상이 아니다", () => {
    expect(run([candidate({ teacherId: null, classroomId: null })], [existing()])).toHaveLength(0);
  });

  it("같은 기존 슬롯을 여러 후보가 때려도 중복 없이 1건", () => {
    const items = run(
      [candidate({ startTime: "16:00", endTime: "16:30" }), candidate({ startTime: "16:20", endTime: "17:00" })],
      [existing({ teacherId: null, teacherName: null })],
    );
    expect(items).toHaveLength(1);
  });

  it("요일·시각 순으로 정렬된다", () => {
    const items = run(
      [candidate({ dayOfWeek: "wed" }), candidate({ dayOfWeek: "mon", startTime: "09:00", endTime: "10:00" })],
      [
        existing({ classId: "c-w", className: "수요반", dayOfWeek: "wed", teacherId: null, teacherName: null }),
        existing({ classId: "c-m", className: "월요반", startTime: "09:00", endTime: "10:00", teacherId: null, teacherName: null }),
      ],
    );
    expect(items.map((i) => i.dayOfWeek)).toEqual(["mon", "wed"]);
  });
});

describe("한글 경고 문장", () => {
  it("한 줄 라벨에 영문 키가 없다", () => {
    const [item] = run([candidate({ teacherId: null })], [existing()]);
    expect(overlapItemLabel(item!)).toBe("중2 수학A · 월요일 16:00~17:30 · 본원303");
  });
  it("이름을 못 풀어도 영문 코드 대신 한글 폴백", () => {
    const [item] = run([candidate({ classroomId: null })], [existing({ teacherName: null })]);
    expect(overlapItemLabel(item!)).toContain("같은 강사");
  });
  it("요약은 반 수·건수·원인별 건수를 밝힌다", () => {
    const items = run([candidate()], [existing(), existing({ classId: "c-2", className: "중3 영어B" })]);
    expect(overlapSummary(items)).toBe("2개 반과 4건 겹칩니다 (강의실 2건 · 강사 2건)");
    expect(overlapSummary([])).toBe("겹치는 반이 없습니다.");
  });
});
