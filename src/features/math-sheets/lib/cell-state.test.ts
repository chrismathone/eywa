import { describe, expect, it } from "vitest";
import { cellStateOf, foldDayAttendance, tallyCells, type MathCellState } from "./cell-state";

const E = (startDate: string, endDate: string | null = null, isTransferred = false) => ({
  startDate,
  endDate,
  isTransferred,
});
const enr = [E("2026-03-01")];
/** 이 파일의 날짜는 전부 2026-08이라 "지난 날"이다 — 미래 칸(`upcoming`)은 아래 전용 describe에서. */
const TODAY = "2026-09-01";

describe("cellStateOf — 기록이 없는 이유를 가른다(휴일은 아래 전용 describe)", () => {
  it("기록이 있으면 written", () => {
    expect(cellStateOf({ enrollments: enr, withdrawnAt: null, date: "2026-08-05", attendance: "present", hasReport: true, today: TODAY })).toBe(
      "written",
    );
  });

  it("🔴 왔는데 기록이 없으면 unwritten(진짜 미작성)", () => {
    // 실측: 박지성 2026-08-05 = present인데 lesson_reports 없음
    expect(cellStateOf({ enrollments: enr, withdrawnAt: null, date: "2026-08-05", attendance: "present", hasReport: false, today: TODAY })).toBe(
      "unwritten",
    );
  });

  it("🔴 결석이면 absent — 안 온 사람의 수업 기록을 재촉하지 않는다", () => {
    expect(cellStateOf({ enrollments: enr, withdrawnAt: null, date: "2026-08-05", attendance: "absent", hasReport: false, today: TODAY })).toBe(
      "absent",
    );
    expect(cellStateOf({ enrollments: enr, withdrawnAt: null, date: "2026-08-05", attendance: "excused", hasReport: false, today: TODAY })).toBe(
      "absent",
    );
  });

  it("🔴 출결도 기록도 없으면 untracked — 미작성과 섞지 않는다", () => {
    // 실측: 김동리·권민서A는 8월 네 수업일에 출결 행 자체가 없다
    expect(cellStateOf({ enrollments: enr, withdrawnAt: null, date: "2026-08-05", attendance: null, hasReport: false, today: TODAY })).toBe(
      "untracked",
    );
  });

  it("지각·조퇴·보강은 '왔다'로 친다", () => {
    for (const s of ["late", "early_leave", "makeup"]) {
      expect(cellStateOf({ enrollments: enr, withdrawnAt: null, date: "2026-08-05", attendance: s, hasReport: false, today: TODAY })).toBe(
        "unwritten",
      );
    }
  });

  it("모르는 상태값을 '왔다'로 넘겨짚지 않는다", () => {
    expect(cellStateOf({ enrollments: enr, withdrawnAt: null, date: "2026-08-05", attendance: "무언가", hasReport: false, today: TODAY })).toBe(
      "untracked",
    );
  });

  it("🔴 수강 기간 밖은 off-roster — 오지도 않은 날을 빠뜨린 것처럼 칠하지 않는다", () => {
    const late = [E("2026-08-20")];
    expect(cellStateOf({ enrollments: late, withdrawnAt: null, date: "2026-08-05", attendance: null, hasReport: false, today: TODAY })).toBe(
      "off-roster",
    );
    expect(cellStateOf({ enrollments: late, withdrawnAt: null, date: "2026-08-26", attendance: null, hasReport: false, today: TODAY })).toBe(
      "untracked",
    );
  });

  it("나갔다 돌아온 학생은 두 구간 중 하나라도 걸리면 명단", () => {
    const two = [E("2026-03-01", "2026-08-10"), E("2026-08-24")];
    expect(cellStateOf({ enrollments: two, withdrawnAt: null, date: "2026-08-05", attendance: null, hasReport: false, today: TODAY })).toBe(
      "untracked",
    );
    expect(cellStateOf({ enrollments: two, withdrawnAt: null, date: "2026-08-19", attendance: null, hasReport: false, today: TODAY })).toBe(
      "off-roster",
    );
    expect(cellStateOf({ enrollments: two, withdrawnAt: null, date: "2026-08-26", attendance: null, hasReport: false, today: TODAY })).toBe(
      "untracked",
    );
  });

  it("🔴 반이동 전출은 종료일 **당일에** 끝난다 — 옛 반에 하루 더 남으면 안 된다", () => {
    const moved = [E("2026-03-01", "2026-08-19", true)];
    expect(cellStateOf({ enrollments: moved, withdrawnAt: null, date: "2026-08-19", attendance: null, hasReport: false, today: TODAY })).toBe(
      "off-roster",
    );
    // 일반 종료(전출 아님)는 종료일 당일까지 재원 — 두 규약이 다르다.
    const ended = [E("2026-03-01", "2026-08-19", false)];
    expect(cellStateOf({ enrollments: ended, withdrawnAt: null, date: "2026-08-19", attendance: null, hasReport: false, today: TODAY })).toBe(
      "untracked",
    );
  });

  it("🔴 학원 퇴원은 수강에 종료일이 없어도 잡는다", () => {
    expect(
      cellStateOf({ enrollments: enr, withdrawnAt: "2026-08-10", date: "2026-08-19", attendance: null, hasReport: false, today: TODAY }),
    ).toBe("off-roster");
    expect(
      cellStateOf({ enrollments: enr, withdrawnAt: "2026-08-10", date: "2026-08-05", attendance: null, hasReport: false, today: TODAY }),
    ).toBe("untracked");
  });

  it("start_date가 없는 행은 명단 근거로 쓰지 않는다", () => {
    expect(
      cellStateOf({
        enrollments: [{ startDate: null, endDate: null, isTransferred: false }],
        withdrawnAt: null,
        date: "2026-08-05",
        attendance: null,
        hasReport: false,
        today: TODAY,
      }),
    ).toBe("off-roster");
  });
});

describe("foldDayAttendance — 하루 여러 교시를 대표 하나로", () => {
  it("🔴 결석이 이긴다(1교시 출석·2교시 결석을 '출석'으로 접으면 결석이 사라진다)", () => {
    expect(foldDayAttendance(["present", "absent"])).toBe("absent");
    expect(foldDayAttendance(["absent", "present"])).toBe("absent");
  });

  it("결석이 없으면 먼저 온 '왔다'", () => {
    expect(foldDayAttendance([null, "late", "present"])).toBe("late");
  });

  it("아무것도 없으면 null", () => {
    expect(foldDayAttendance([null, undefined])).toBeNull();
  });
});

describe("tallyCells — 분모에 안 온 날을 넣지 않는다", () => {
  const states = (n: number, s: MathCellState): MathCellState[] => Array<MathCellState>(n).fill(s);

  it("🔴 결석·흔적없음은 분모 밖 — 결석 많은 반의 담임이 나쁘게 보이면 안 된다", () => {
    const t = tallyCells([...states(8, "written"), ...states(2, "unwritten"), ...states(10, "absent")]);
    expect(t).toMatchObject({ written: 8, unwritten: 2, absent: 10, total: 20 });
    expect(t.pct).toBe(80); // 8/10 — 결석 10칸은 분모에 없다
  });

  it("off-roster는 아예 안 센다", () => {
    const t = tallyCells([...states(4, "written"), ...states(6, "off-roster")]);
    expect(t.total).toBe(4);
  });

  it("온 칸이 하나도 없으면 0%가 아니라 100%(셀 것이 없다)", () => {
    expect(tallyCells(states(5, "untracked")).pct).toBe(100);
  });
});

describe("cellStateOf — 아직 안 지난 수업일(upcoming)", () => {
  // 원장 2026-09-01 제보: 9월 시트가 칸마다 "출결도 기록도 없음"이었다. 아무도 잘못한 게 없는데
  // 지난 일의 실패와 같은 문장·같은 회색이었다.
  it("🔴 오늘보다 뒤이고 흔적이 없으면 upcoming — untracked가 아니다", () => {
    expect(
      cellStateOf({
        enrollments: enr,
        withdrawnAt: null,
        date: "2026-09-16",
        attendance: null,
        hasReport: false,
        today: "2026-09-01",
      }),
    ).toBe("upcoming");
  });

  it("오늘은 아직 안 지난 날이 아니다 — 경계는 '뒤'만", () => {
    expect(
      cellStateOf({
        enrollments: enr,
        withdrawnAt: null,
        date: "2026-09-01",
        attendance: null,
        hasReport: false,
        today: "2026-09-01",
      }),
    ).toBe("untracked");
  });

  it("🔴 미리 찍힌 사실이 달력을 이긴다 — 미래여도 기록·출결이 있으면 그 상태다", () => {
    const future = { enrollments: enr, withdrawnAt: null, date: "2026-09-16", today: "2026-09-01" };
    expect(cellStateOf({ ...future, attendance: "present", hasReport: true })).toBe("written");
    expect(cellStateOf({ ...future, attendance: "absent", hasReport: false })).toBe("absent");
    expect(cellStateOf({ ...future, attendance: "present", hasReport: false })).toBe("unwritten");
  });

  it("수강 밖이 먼저다 — 미래여도 명단이 아니면 off-roster", () => {
    expect(
      cellStateOf({
        enrollments: [E("2026-10-01")],
        withdrawnAt: null,
        date: "2026-09-16",
        attendance: null,
        hasReport: false,
        today: "2026-09-01",
      }),
    ).toBe("off-roster");
  });

  it("🔴 작성률·흔적 없음 어디에도 안 들어간다 — 아무 일도 안 일어난 것을 실패로 세지 않는다", () => {
    const t = tallyCells(["upcoming", "upcoming", "written", "unwritten"] as MathCellState[]);
    expect(t.upcoming).toBe(2);
    expect(t.untracked).toBe(0);
    expect(t.total).toBe(2); // written + unwritten (upcoming은 분모 밖)
    expect(t.pct).toBe(50);
  });

  it("전부 미래면 작성률은 100%가 아니라 '셀 것이 없음'이다(분모 0 → 100 유지, total 0)", () => {
    const t = tallyCells(["upcoming", "upcoming"] as MathCellState[]);
    expect(t.total).toBe(0);
    expect(t.upcoming).toBe(2);
    expect(t.pct).toBe(100);
  });
});

/**
 * 휴일 — 규약은 [`holiday.ts`](@/features/class-sheets/lib/holiday) 하나이고, 여기서는 **MCS 칸이 그
 * 규약을 타는지**와 **결석·무기록과 안 섞이는지**를 본다(cell-state.ts의 상시 규약).
 */
describe("휴일 — 넷과 섞지 않는 다섯째 이유", () => {
  const base = { enrollments: enr, withdrawnAt: null, date: "2026-08-17", today: TODAY };

  it("🔴 휴일이면 holiday — 결석·무기록과 다른 상태다", () => {
    expect(cellStateOf({ ...base, attendance: null, hasReport: false, holiday: true })).toBe("holiday");
    // 같은 칸이라도 휴일이 아니면 종전대로 untracked(평일 불변).
    expect(cellStateOf({ ...base, attendance: null, hasReport: false })).toBe("untracked");
  });

  it("🔴 **사실이 달력을 이긴다** — 휴일에 수업하고 적었으면 written이다(한 일로 인정)", () => {
    expect(cellStateOf({ ...base, attendance: "present", hasReport: true, holiday: true })).toBe("written");
  });

  it("🔴 휴일은 결석·출석보다 먼저 이긴다 — 학원이 안 연 날에 '미작성'은 성립하지 않는다", () => {
    // 실측 2026-08-17(대체공휴일)엔 출결 21행이 있다. 그래도 쓸 의무는 없었다.
    expect(cellStateOf({ ...base, attendance: "present", hasReport: false, holiday: true })).toBe("holiday");
    expect(cellStateOf({ ...base, attendance: "absent", hasReport: false, holiday: true })).toBe("holiday");
  });

  it("🔴 수강 밖은 여전히 off-roster — 휴일이 로스터 판정을 덮지 않는다(축이 다르다)", () => {
    expect(
      cellStateOf({
        enrollments: [E("2026-09-01")],
        withdrawnAt: null,
        date: "2026-08-17",
        attendance: null,
        hasReport: false,
        today: TODAY,
        holiday: true,
      }),
    ).toBe("off-roster");
  });

  it("🔴 안 쓴 휴일은 분모에도 '흔적 없음'에도 안 들어간다 — 따로 센다", () => {
    const t = tallyCells(["holiday", "holiday", "written", "unwritten"] as MathCellState[]);
    expect(t.holiday).toBe(2);
    expect(t.untracked).toBe(0);
    expect(t.absent).toBe(0);
    expect(t.total).toBe(2); // written + unwritten만
    expect(t.pct).toBe(50);
  });

  it("🔴 추석이 낀 달이라고 작성률이 나빠지지 않는다(안 쓴 휴일은 없는 칸과 같다)", () => {
    const without = tallyCells(["written", "written"] as MathCellState[]);
    const with_ = tallyCells(["written", "written", "holiday", "holiday", "holiday"] as MathCellState[]);
    expect(with_.pct).toBe(without.pct);
    expect(with_.pct).toBe(100);
    expect(with_.total).toBe(2);
  });
});
