import { describe, expect, it } from "vitest";
import { DEFAULT_PERIODS_CONFIG } from "@/features/timetable/lib/periods";
import {
  RESERVED_CELL_CHARS,
  RESERVED_CELL_LABEL,
  completesReservation,
  contiguousPeriodRange,
  reservationAutoUnits,
  reservationSpanMinutes,
  togglePeriodSelection,
  isWeekendYmd,
  markAbsenceMemoDone,
  markAbsenceMemoPlanned,
  pickFulfillingRow,
  removeMemoLine,
  reservationAbsenceDoneMemo,
  reservationAbsenceMemo,
  reservationMakeupMemo,
  reservationPeriodLabel,
  reservationPeriodOptions,
  reservationSpanLabel,
  reservationTitle,
  sameReservationSlot,
  scheduledMakeupLabel,
  scheduledMakeupTitle,
  toTimetableReservedLine,
  validateReservationDates,
} from "./makeup-reservation";

describe("보강 예약 — 칸 글자", () => {
  it("사분면 네 글자가 곧 '보강 예약'이다(원장 2026-09-14) — 한쪽만 바꾸면 범례와 칸이 갈린다", () => {
    expect(RESERVED_CELL_CHARS.join("")).toBe(RESERVED_CELL_LABEL.replace(" ", ""));
    expect(RESERVED_CELL_CHARS).toHaveLength(4);
  });
});

describe("보강 예약 — 날짜 검증", () => {
  const today = "2026-09-14";
  it("미래 보강일은 통과한다(사전 결석 통보 → 미리 잡는 보강)", () => {
    expect(validateReservationDates({ absenceDate: "2026-09-30", makeupDate: "2026-10-05", today })).toEqual({ ok: true });
  });
  it("결석일과 보강일이 같으면 거절", () => {
    const r = validateReservationDates({ absenceDate: "2026-10-05", makeupDate: "2026-10-05", today });
    expect(r.ok).toBe(false);
  });
  it("지난 보강일은 거절 — 이미 한 보강은 그날 칸에 '보강'으로 찍는 것", () => {
    const r = validateReservationDates({ absenceDate: "2026-09-01", makeupDate: "2026-09-10", today });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/지난 날짜/);
  });
  it("오늘은 통과한다(오늘 저녁 보강)", () => {
    expect(validateReservationDates({ absenceDate: "2026-09-10", makeupDate: today, today }).ok).toBe(true);
  });
  it("180일을 넘기면 거절", () => {
    expect(validateReservationDates({ absenceDate: "2026-09-10", makeupDate: "2027-04-01", today }).ok).toBe(false);
  });
  it("형식이 아니면 거절(빈 보강일 = 아직 안 골랐다)", () => {
    expect(validateReservationDates({ absenceDate: "2026-09-10", makeupDate: "", today }).ok).toBe(false);
  });
});

describe("보강 예약 — 교시 선택지(수기 금지)", () => {
  it("평일은 그 과목의 평일 교시표에서만 — 수학은 1-1 꼴 이름 + 시각", () => {
    const opts = reservationPeriodOptions("math", "2026-10-05", DEFAULT_PERIODS_CONFIG);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts[0]!.label).toMatch(/^1-1 · \d{2}:\d{2}~\d{2}:\d{2}$/);
    expect(opts.every((o) => /^\d{2}:\d{2}$/.test(o.startTime) && /^\d{2}:\d{2}$/.test(o.endTime))).toBe(true);
  });
  it("주말은 과목 무관 주말 교시표(09:00부터)", () => {
    const sat = reservationPeriodOptions("math", "2026-10-03", DEFAULT_PERIODS_CONFIG);
    expect(isWeekendYmd("2026-10-03")).toBe(true);
    expect(sat[0]!.startTime).toBe("09:00");
    // 평일 표와 다르다(주말 09:00 vs 평일 오후) — 같은 표를 돌려주면 주말 예약이 평일 시각에 선다.
    const mon = reservationPeriodOptions("math", "2026-10-05", DEFAULT_PERIODS_CONFIG);
    expect(mon[0]!.startTime).not.toBe(sat[0]!.startTime);
  });
  it("영어 평일은 영어 교시표(11교시)", () => {
    const opts = reservationPeriodOptions("english", "2026-10-05", DEFAULT_PERIODS_CONFIG);
    expect(opts.length).toBeGreaterThanOrEqual(10);
  });
  it("형식이 아닌 날짜는 빈 목록", () => {
    expect(reservationPeriodOptions("math", "10/05", DEFAULT_PERIODS_CONFIG)).toEqual([]);
  });
  it("저장 라벨 — 주말은 '주말' 접두, 이름을 비운 교시는 null(시각이 이미 있다)", () => {
    const sat = reservationPeriodOptions("math", "2026-10-03", DEFAULT_PERIODS_CONFIG)[0]!;
    expect(reservationPeriodLabel(sat, "2026-10-03")).toBe("주말 1교시");
    const mon = reservationPeriodOptions("math", "2026-10-05", DEFAULT_PERIODS_CONFIG)[0]!;
    expect(reservationPeriodLabel(mon, "2026-10-05")).toBe("1-1");
    expect(reservationPeriodLabel({ id: "1", label: "14:30~15:25", startTime: "14:30", endTime: "15:25" }, "2026-10-05")).toBeNull();
  });
});

describe("보강 예약 — 메모(기존 보강 규약과 같은 문장)", () => {
  const r = { absenceDate: "2026-09-30", makeupDate: "2026-10-05" };
  it("결석 칸: '10/5 보강 예정' · 보강 칸: '9/30 결석분 보강'", () => {
    expect(reservationAbsenceMemo(r)).toBe("10/5 보강 예정");
    expect(reservationMakeupMemo(r)).toBe("9/30 결석분 보강");
  });
  it("선보강(보강이 결석보다 앞)도 결석 칸은 '예정' — 예약은 아직 안 한 것이다(재리뷰 2026-09-14) · 보강 칸은 '결석 예정분'", () => {
    const pre = { absenceDate: "2026-10-05", makeupDate: "2026-09-30" };
    expect(reservationAbsenceMemo(pre)).toBe("9/30 보강 예정");
    expect(reservationAbsenceDoneMemo(pre)).toBe("9/30 보강 완료");
    expect(reservationMakeupMemo(pre)).toBe("10/5 결석 예정분 보강");
    // 이행·되돌림이 옮기는 줄과 글자까지 같다 — 갈리면 취소가 줄을 못 찾는다.
    expect(markAbsenceMemoDone(reservationAbsenceMemo(pre), pre.makeupDate)).toBe(reservationAbsenceDoneMemo(pre));
    expect(markAbsenceMemoPlanned(reservationAbsenceDoneMemo(pre), pre.makeupDate)).toBe(reservationAbsenceMemo(pre));
  });
  it("이행 뒤 결석 칸 '예정' → '완료' — 다른 줄(사유)은 그대로", () => {
    expect(markAbsenceMemoDone("병결\n10/5 보강 예정", "2026-10-05")).toBe("병결\n10/5 보강 완료");
    expect(markAbsenceMemoDone("병결", "2026-10-05")).toBe("병결");
    expect(markAbsenceMemoDone(null, "2026-10-05")).toBeNull();
  });
  it("취소 — 그 줄만 빼고 다 비면 null", () => {
    expect(removeMemoLine("병결\n10/5 보강 예정", "10/5 보강 예정")).toBe("병결");
    expect(removeMemoLine("10/5 보강 예정", "10/5 보강 예정")).toBeNull();
    // 부분 일치가 아니다 — "10/15 보강 예정"은 남는다.
    expect(removeMemoLine("10/15 보강 예정", "10/5 보강 예정")).toBe("10/15 보강 예정");
  });
});

describe("보강 예약 — 이어진 교시 여러 개(원장 2026-09-14)", () => {
  const opts = reservationPeriodOptions("math", "2026-10-05", DEFAULT_PERIODS_CONFIG);
  it("연속 선택 = 첫 시작 ~ 마지막 끝, 라벨 1-1~1-2, 분은 실제 구간", () => {
    const r = contiguousPeriodRange(opts, [opts[1]!.id, opts[0]!.id], "2026-10-05");
    expect(r).not.toBeNull();
    expect(r!.startTime).toBe(opts[0]!.startTime);
    expect(r!.endTime).toBe(opts[1]!.endTime);
    expect(r!.label).toBe("1-1~1-2");
    expect(r!.count).toBe(2);
    expect(r!.minutes).toBeGreaterThan(55);
  });
  it("중간이 빈 선택·모르는 id·빈 선택은 null", () => {
    expect(contiguousPeriodRange(opts, [opts[0]!.id, opts[2]!.id], "2026-10-05")).toBeNull();
    expect(contiguousPeriodRange(opts, ["nope"], "2026-10-05")).toBeNull();
    expect(contiguousPeriodRange(opts, [], "2026-10-05")).toBeNull();
  });
  it("칩 토글 — 옆을 누르면 늘고, 끝을 누르면 빠지고, 가운데·떨어진 곳은 그 하나로 다시 시작", () => {
    const id = (i: number) => opts[i]!.id;
    expect(togglePeriodSelection(opts, [], id(2))).toEqual([id(2)]);
    expect(togglePeriodSelection(opts, [id(2)], id(3))).toEqual([id(2), id(3)]);
    expect(togglePeriodSelection(opts, [id(2), id(3)], id(1))).toEqual([id(1), id(2), id(3)]);
    expect(togglePeriodSelection(opts, [id(1), id(2), id(3)], id(3))).toEqual([id(1), id(2)]);
    expect(togglePeriodSelection(opts, [id(1), id(2), id(3)], id(2))).toEqual([id(2)]);
    expect(togglePeriodSelection(opts, [id(1), id(2)], id(5))).toEqual([id(5)]);
    expect(togglePeriodSelection(opts, [id(1)], id(1))).toEqual([]);
  });
  it("시수 자동값 = 수학 자동 시수와 같은 식(교시 하나 0.5 · 둘 1 · 셋 1.5), 영어는 없음", () => {
    expect(reservationAutoUnits({ slotStart: "14:20", slotEnd: "15:20" }, "math")).toBe(0.5);
    expect(reservationAutoUnits({ slotStart: "14:20", slotEnd: "16:20" }, "math")).toBe(1);
    expect(reservationAutoUnits({ slotStart: "14:20", slotEnd: "17:15" }, "math")).toBe(1.5);
    expect(reservationAutoUnits({ slotStart: "14:20", slotEnd: "16:20" }, "english")).toBeNull();
    expect(reservationSpanMinutes({ slotStart: "14:20", slotEnd: "16:20" })).toBe(120);
  });
});

describe("보강 예약 — 이행 행 고르기(pickFulfillingRow)", () => {
  const r = { slotStart: "17:20", slotEnd: "18:20" };
  const row = (o: Partial<{ id: string; slotStart: string | null; status: string; recordedAt: string }>) => ({
    id: "a",
    slotStart: null,
    status: "present",
    recordedAt: "2026-10-05T10:00:00Z",
    ...o,
  });
  it("그날 전체 행(교시 없음)이 있으면 그 최신 — 수학", () => {
    const rows = [row({ id: "old", recordedAt: "2026-10-05T09:00:00Z" }), row({ id: "new" })];
    expect(pickFulfillingRow(rows, r)?.id).toBe("new");
  });
  it("교시 행만 있으면 예약 구간 안에서 시작하는 행만 — 정규 16:20 출석은 17:20 보강 예약을 이행시키지 않는다", () => {
    const regular = row({ id: "reg", slotStart: "16:20:00" });
    expect(pickFulfillingRow([regular], r)).toBeNull();
    const makeup = row({ id: "mk", slotStart: "17:20:00" });
    expect(pickFulfillingRow([regular, makeup], r)?.id).toBe("mk");
    // 두 교시 예약(17:20~19:20)이면 둘째 교시 출석도 이행이다.
    expect(pickFulfillingRow([row({ id: "p2", slotStart: "18:20:00" })], { slotStart: "17:20", slotEnd: "19:20" })?.id).toBe("p2");
  });
  it("결석·공결·지우기(행 없음)는 이행이 아니다", () => {
    expect(pickFulfillingRow([row({ status: "absent" })], r)).toBeNull();
    expect(pickFulfillingRow([], r)).toBeNull();
  });
  it("되돌림 — 결석 칸 '완료' → '예정'(다른 줄은 그대로), 줄이 없으면 그대로", () => {
    expect(markAbsenceMemoPlanned("병결\n10/5 보강 완료", "2026-10-05")).toBe("병결\n10/5 보강 예정");
    expect(markAbsenceMemoPlanned("병결", "2026-10-05")).toBe("병결");
    expect(markAbsenceMemoPlanned(null, "2026-10-05")).toBeNull();
  });
});

describe("보강 예약 — 이행 판정·표기", () => {
  it("시수를 쓰는 상태만 이행(결석·공결·지우기는 아니다)", () => {
    expect(completesReservation("present")).toBe(true);
    expect(completesReservation("makeup")).toBe(true);
    expect(completesReservation("late")).toBe(true);
    expect(completesReservation("early_leave")).toBe(true);
    expect(completesReservation("absent")).toBe(false);
    expect(completesReservation("excused")).toBe(false);
    expect(completesReservation(null)).toBe(false);
  });
  it("자리 한 줄 + 툴팁 — raw 코드 없이 한글로", () => {
    const r = {
      absenceDate: "2026-09-30",
      makeupDate: "2026-10-05",
      slotStart: "16:20",
      slotEnd: "17:15",
      periodLabel: "1-1",
      note: "학부모 요청",
    };
    expect(reservationSpanLabel(r)).toBe("10/5(월) 1-1 · 16:20~17:15");
    const title = reservationTitle(r, { createdByName: "김예원", className: "중2A" });
    expect(title).toBe("보강 예약 · 중2A · 9/30 결석분 · 10/5(월) 1-1 · 16:20~17:15 · 예약: 김예원 · 학부모 요청");
    expect(title).not.toMatch(/reserved|mon/);
  });
  it("남의 반 줄엔 원반이 **꼬리표와 툴팁 둘 다**에 들어간다 — 툴팁만으론 모바일에서 못 본다", () => {
    const r = {
      id: "r1",
      studentId: "s1",
      classId: "c1",
      absenceDate: "2026-09-15",
      makeupDate: "2026-09-17",
      slotStart: "14:20",
      slotEnd: "16:20",
      periodLabel: "1-1~1-2",
      note: null,
      status: "reserved" as const,
      createdBy: null,
    };
    const stu = { name: "안은지", grade: "중1", school: "경명여중" };
    const stray = toTimetableReservedLine(r, stu, { className: "고등M 개별 TP4E" });
    expect(stray.fromClassName).toBe("고등M 개별 TP4E");
    expect(stray.title).toContain("고등M 개별 TP4E");
    // 이 반 칸에 선 줄은 꼬리표가 없다(그 칸이 곧 그 반이다).
    const own = toTimetableReservedLine(r, stu);
    expect(own.fromClassName).toBeUndefined();
    expect(own.title).not.toContain("고등M");
    // 빈 값·공백은 없는 것으로(지어내지 않는다).
    expect(toTimetableReservedLine(r, stu, { className: "  " }).fromClassName).toBeUndefined();
    expect(toTimetableReservedLine(r, stu, { className: null }).fromClassName).toBeUndefined();
  });

  it("같은 축(학생·반·보강일·교시) 판정은 HH:MM 앞 5자로", () => {
    const a = { studentId: "s", classId: "c", makeupDate: "2026-10-05", slotStart: "16:20" };
    expect(sameReservationSlot(a, { ...a, slotStart: "16:20:00" })).toBe(true);
    expect(sameReservationSlot(a, { ...a, slotStart: "17:20" })).toBe(false);
  });
});

describe("보강 예약 — 학생 상세 '예정된 변경' 배너 한 줄", () => {
  // 실제 제보 건(원장 2026-09-14): 안은지 9/15 결석 → 9/17(목) 14:20~16:20 보강, 원반 고등M 개별 TP4E.
  const line = {
    id: "r1",
    absenceDate: "2026-09-15",
    makeupDate: "2026-09-17",
    slotStart: "14:20",
    slotEnd: "16:20",
    periodLabel: "1-1~1-2",
    note: null,
    className: "고등M 개별 TP4E",
  };

  it("언제·몇 시·무슨 결석분·어느 반인지가 한 줄에 있다", () => {
    expect(scheduledMakeupLabel(line, "2026-09-14")).toBe(
      "9/17 (목) 14:20~16:20 보강 예약 · 9/15 결석분 · 고등M 개별 TP4E",
    );
  });

  it("🔴 반 이름을 모르면 그 조각만 빠진다 — 지어내지 않는다", () => {
    expect(scheduledMakeupLabel({ ...line, className: null }, "2026-09-14")).toBe(
      "9/17 (목) 14:20~16:20 보강 예약 · 9/15 결석분",
    );
    expect(scheduledMakeupLabel({ ...line, className: "  " }, "2026-09-14")).toBe(
      "9/17 (목) 14:20~16:20 보강 예약 · 9/15 결석분",
    );
  });

  it("해가 다른 날짜에만 두 자리 연도를 붙인다(예약 상한 180일이라 해를 넘긴다)", () => {
    const s = scheduledMakeupLabel(
      { ...line, absenceDate: "2026-12-28", makeupDate: "2027-01-05" },
      "2026-12-30",
    );
    expect(s).toContain("27. 1/5");
    expect(s).toContain("· 12/28 결석분"); // 올해라 연도 없음
  });

  it("영어 화면이면 요일도 영어 — 한 줄이 반쪽만 한국어가 되지 않는다(반 이름은 사람이 지은 이름이라 그대로)", () => {
    const s = scheduledMakeupLabel(line, "2026-09-14", "en");
    expect(s).toContain("9/17 (Thu)");
    expect(s).not.toContain("(목)");
    expect(s).toContain("고등M 개별 TP4E");
    expect(scheduledMakeupLabel({ ...line, origin: "reservation" }, "2026-09-14")).toBe(scheduledMakeupLabel(line, "2026-09-14"));
    const native = scheduledMakeupLabel({ ...line, origin: "native" }, "2026-09-14", "en");
    expect(native).toContain("participation");
    expect(scheduledMakeupLabel({ ...line, origin: "native" }, "2026-09-14")).toContain("보강 참여");
    expect(native).not.toContain("보강 참여");
    expect(scheduledMakeupLabel({ ...line, origin: "additional" }, "2026-09-14")).toContain("추가 지도");
  });

  it("툴팁은 칸·시간표와 **같은 함수** — 교시·원반·메모까지 담는다", () => {
    expect(scheduledMakeupTitle(line)).toBe(reservationTitle(line, { className: line.className }));
    expect(scheduledMakeupTitle(line)).toContain("고등M 개별 TP4E");
    expect(scheduledMakeupTitle(line)).not.toMatch(/reserved|thu/);
  });
});
