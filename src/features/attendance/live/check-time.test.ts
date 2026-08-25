import { describe, expect, it } from "vitest";
import { attendanceCheckMark, isDeskIntakeNote, seatRecorderName } from "./check-time";

/**
 * ⚠️ 이 스위트는 **TZ를 UTC로 가정하지 않는다** — 서식이 KST로 못박혀 있는지가 요점이라
 * 이 PC(KST)에서 돌리든 Vercel(UTC)에서 돌리든 같은 값이 나와야 한다.
 */
describe("출결 체크 시각 — KST 고정", () => {
  it("UTC 원본을 KST(+9)로 옮겨 그린다", () => {
    // 06:08Z = 15:08 KST
    expect(attendanceCheckMark("2026-08-21T06:08:00Z", "2026-08-21")?.time).toBe("15:08");
  });

  it("자정은 24시가 아니라 00시다", () => {
    // 15:00Z = 다음날 00:00 KST
    expect(attendanceCheckMark("2026-08-20T15:00:00Z", "2026-08-21")?.time).toBe("00:00");
  });

  it("KST 새벽 기록은 UTC 날짜와 하루 어긋난다 — 날짜 판정도 KST 기준", () => {
    // 2026-08-20T23:30Z = 2026-08-21 08:30 KST → 수업일 08-21과 **같은 날**이다
    const m = attendanceCheckMark("2026-08-20T23:30:00Z", "2026-08-21");
    expect(m).toEqual({ time: "08:30", date: null, full: "2026-08-21 08:30", afterClass: false });
  });

  it("오프셋이 붙은 ISO(+09:00)도 같은 시각으로 읽는다", () => {
    expect(attendanceCheckMark("2026-08-21T15:08:00+09:00", "2026-08-21")?.time).toBe("15:08");
  });
});

describe("수업일과 다른 날에 찍은 기록 — 날짜를 숨기지 않는다", () => {
  it("같은 날이면 맨 시각만", () => {
    expect(attendanceCheckMark("2026-08-21T06:08:00Z", "2026-08-21")).toEqual({
      time: "15:08",
      date: null,
      full: "2026-08-21 15:08",
      afterClass: false,
    });
  });

  it("미래 수업일을 미리 결석 처리한 행은 찍은 날짜가 드러난다", () => {
    // 수업일 08-28인데 체크는 08-21 → `15:08`만 띄우면 그날 찍은 것처럼 읽힌다
    expect(attendanceCheckMark("2026-08-21T06:08:00Z", "2026-08-28")).toEqual({
      time: "15:08",
      date: "8/21",
      full: "2026-08-21 15:08",
      afterClass: false,
    });
  });

  it("지난 날짜를 나중에 메운 기록도 마찬가지다", () => {
    expect(attendanceCheckMark("2026-08-21T06:08:00Z", "2026-08-19")?.date).toBe("8/21");
  });

  it("해가 바뀌어도 월/일만 붙인다 — 연도는 툴팁(full)에 있다", () => {
    const m = attendanceCheckMark("2025-12-31T15:30:00Z", "2026-08-21");
    expect(m).toEqual({ time: "00:30", date: "1/1", full: "2026-01-01 00:30", afterClass: false });
  });

  it("수업일을 모르면 날짜를 붙인다 — 모르는 채로 맨 시각을 그리는 게 더 위험하다", () => {
    expect(attendanceCheckMark("2026-08-21T06:08:00Z", null)?.date).toBe("8/21");
    expect(attendanceCheckMark("2026-08-21T06:08:00Z", "")?.date).toBe("8/21");
  });
});

describe("기록이 없거나 깨진 값 — 아래 줄을 안 그린다", () => {
  it("미출결(값 없음)은 null", () => {
    expect(attendanceCheckMark(null, "2026-08-21")).toBeNull();
    expect(attendanceCheckMark(undefined, "2026-08-21")).toBeNull();
    expect(attendanceCheckMark("", "2026-08-21")).toBeNull();
  });

  it("파싱 불가 값에 'Invalid Date'를 화면에 내보내지 않는다", () => {
    expect(attendanceCheckMark("어제쯤", "2026-08-21")).toBeNull();
    expect(attendanceCheckMark("2026-13-45T99:99:99Z", "2026-08-21")).toBeNull();
  });
});

describe("자릿수 — 시각은 두 자리, 날짜는 원장 시안대로 앞자리 0 없이", () => {
  it("시·분은 0으로 채우고(09:03) 월/일은 안 채운다(1/2)", () => {
    const m = attendanceCheckMark("2026-01-02T00:03:00Z", "2026-08-21");
    expect(m).toEqual({ time: "09:03", date: "1/2", full: "2026-01-02 09:03", afterClass: false });
  });
});

describe("입력자 이름 — 담임이 찍었으면 안 적는다", () => {
  const 담임 = "t-1";

  it("담임 본인이 찍었으면 null — 카드 머리에 이미 있는 이름을 칸마다 반복하지 않는다", () => {
    expect(
      seatRecorderName({ recordedBy: 담임, recordedByName: "박소선", classTeacherId: 담임 }),
    ).toBeNull();
  });

  it("다른 사람이 찍었으면 그 이름", () => {
    expect(
      seatRecorderName({ recordedBy: "u-9", recordedByName: "박소선", classTeacherId: 담임 }),
    ).toBe("박소선");
  });

  it("🔴 자리(LAB·JJ)는 아예 안 적는다 — 대신 찍은 한 사람 이름이 전 칸에 반복된다(원장 08-24)", () => {
    expect(
      seatRecorderName({
        recordedBy: "u-9",
        recordedByName: "박소선",
        classTeacherId: null,
        seatLabel: "JJ",
      }),
    ).toBeNull();
    expect(
      seatRecorderName({ recordedBy: "u-9", recordedByName: "박소선", seatLabel: "LAB" }),
    ).toBeNull();
  });

  it("사람 반인데 담당을 모르면(축 null) 입력자를 적는다", () => {
    expect(
      seatRecorderName({ recordedBy: "u-9", recordedByName: "박소선", classTeacherId: null }),
    ).toBe("박소선");
  });

  it("이름을 모르는 id(퇴사자·시스템)는 null — raw uuid를 화면에 내보내지 않는다", () => {
    expect(seatRecorderName({ recordedBy: "u-9", recordedByName: null, classTeacherId: 담임 })).toBeNull();
    expect(seatRecorderName({ recordedBy: "u-9", recordedByName: "  ", classTeacherId: 담임 })).toBeNull();
  });

  it("입력자 id가 비어 있으면(레거시 행) 이름만 보고 적는다", () => {
    expect(
      seatRecorderName({ recordedBy: null, recordedByName: "박소선", classTeacherId: 담임 }),
    ).toBe("박소선");
  });

  it("기록이 없으면 null", () => {
    expect(seatRecorderName({})).toBeNull();
  });
});

describe("수업이 끝난 뒤에 찍은 칸 — 테두리 근거", () => {
  const 수업일 = "2026-08-24";

  it("종료시각을 넘겨 찍었으면 afterClass", () => {
    // 09:11Z = 18:11 KST > 18:10 종료
    expect(attendanceCheckMark("2026-08-24T09:11:00Z", 수업일, "18:10")?.afterClass).toBe(true);
  });

  it("수업 중·시작 전에 찍었으면 아니다", () => {
    expect(attendanceCheckMark("2026-08-24T07:41:00Z", 수업일, "18:10")?.afterClass).toBe(false); // 16:41
    expect(attendanceCheckMark("2026-08-24T09:10:00Z", 수업일, "18:10")?.afterClass).toBe(false); // 정각은 아직
  });

  it("미래 수업일을 미리 찍어 둔 행은 수업 '전'이다 — 지연이 아니다", () => {
    // 8/21에 찍은 8/28 수업 → 시각만 보면 18:11이라 늦어 보이지만 날짜까지 보면 한참 전이다
    expect(attendanceCheckMark("2026-08-21T09:11:00Z", "2026-08-28", "18:10")?.afterClass).toBe(false);
  });

  it("지난 수업일을 나중에 메운 행은 지연이다", () => {
    expect(attendanceCheckMark("2026-08-24T09:11:00Z", "2026-08-19", "18:10")?.afterClass).toBe(true);
  });

  it("종료시각을 모르면 안 붙인다 — 없는 지연을 만들지 않는다", () => {
    expect(attendanceCheckMark("2026-08-24T09:11:00Z", 수업일)?.afterClass).toBe(false);
    expect(attendanceCheckMark("2026-08-24T09:11:00Z", 수업일, null)?.afterClass).toBe(false);
  });
});

describe("데스크 접수건 — 시각을 안 남긴다", () => {
  it("접수가 남긴 메모 한 줄을 표식으로 본다", () => {
    expect(isDeskIntakeNote("가족여행 (데스크 접수)")).toBe(true);
    expect(isDeskIntakeNote("병원\n가족여행 (데스크 접수)")).toBe(true);
  });

  it("강사가 직접 적은 메모는 접수건이 아니다", () => {
    expect(isDeskIntakeNote("감기로 결석")).toBe(false);
    expect(isDeskIntakeNote(null)).toBe(false);
    expect(isDeskIntakeNote("")).toBe(false);
  });
});
