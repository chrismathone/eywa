import { describe, expect, it } from "vitest";
import { cellStateOf, foldDayAttendance, tallyCells, type MathCellState } from "./cell-state";

const E = (startDate: string, endDate: string | null = null, isTransferred = false) => ({
  startDate,
  endDate,
  isTransferred,
});
const enr = [E("2026-03-01")];

describe("cellStateOf — 기록이 없는 이유 셋을 가른다", () => {
  it("기록이 있으면 written", () => {
    expect(cellStateOf({ enrollments: enr, withdrawnAt: null, date: "2026-08-05", attendance: "present", hasReport: true })).toBe(
      "written",
    );
  });

  it("🔴 왔는데 기록이 없으면 unwritten(진짜 미작성)", () => {
    // 실측: 박지성 2026-08-05 = present인데 lesson_reports 없음
    expect(cellStateOf({ enrollments: enr, withdrawnAt: null, date: "2026-08-05", attendance: "present", hasReport: false })).toBe(
      "unwritten",
    );
  });

  it("🔴 결석이면 absent — 안 온 사람의 수업 기록을 재촉하지 않는다", () => {
    expect(cellStateOf({ enrollments: enr, withdrawnAt: null, date: "2026-08-05", attendance: "absent", hasReport: false })).toBe(
      "absent",
    );
    expect(cellStateOf({ enrollments: enr, withdrawnAt: null, date: "2026-08-05", attendance: "excused", hasReport: false })).toBe(
      "absent",
    );
  });

  it("🔴 출결도 기록도 없으면 untracked — 미작성과 섞지 않는다", () => {
    // 실측: 김동리·권민서A는 8월 네 수업일에 출결 행 자체가 없다
    expect(cellStateOf({ enrollments: enr, withdrawnAt: null, date: "2026-08-05", attendance: null, hasReport: false })).toBe(
      "untracked",
    );
  });

  it("지각·조퇴·보강은 '왔다'로 친다", () => {
    for (const s of ["late", "early_leave", "makeup"]) {
      expect(cellStateOf({ enrollments: enr, withdrawnAt: null, date: "2026-08-05", attendance: s, hasReport: false })).toBe(
        "unwritten",
      );
    }
  });

  it("모르는 상태값을 '왔다'로 넘겨짚지 않는다", () => {
    expect(cellStateOf({ enrollments: enr, withdrawnAt: null, date: "2026-08-05", attendance: "무언가", hasReport: false })).toBe(
      "untracked",
    );
  });

  it("🔴 수강 기간 밖은 off-roster — 오지도 않은 날을 빠뜨린 것처럼 칠하지 않는다", () => {
    const late = [E("2026-08-20")];
    expect(cellStateOf({ enrollments: late, withdrawnAt: null, date: "2026-08-05", attendance: null, hasReport: false })).toBe(
      "off-roster",
    );
    expect(cellStateOf({ enrollments: late, withdrawnAt: null, date: "2026-08-26", attendance: null, hasReport: false })).toBe(
      "untracked",
    );
  });

  it("나갔다 돌아온 학생은 두 구간 중 하나라도 걸리면 명단", () => {
    const two = [E("2026-03-01", "2026-08-10"), E("2026-08-24")];
    expect(cellStateOf({ enrollments: two, withdrawnAt: null, date: "2026-08-05", attendance: null, hasReport: false })).toBe(
      "untracked",
    );
    expect(cellStateOf({ enrollments: two, withdrawnAt: null, date: "2026-08-19", attendance: null, hasReport: false })).toBe(
      "off-roster",
    );
    expect(cellStateOf({ enrollments: two, withdrawnAt: null, date: "2026-08-26", attendance: null, hasReport: false })).toBe(
      "untracked",
    );
  });

  it("🔴 반이동 전출은 종료일 **당일에** 끝난다 — 옛 반에 하루 더 남으면 안 된다", () => {
    const moved = [E("2026-03-01", "2026-08-19", true)];
    expect(cellStateOf({ enrollments: moved, withdrawnAt: null, date: "2026-08-19", attendance: null, hasReport: false })).toBe(
      "off-roster",
    );
    // 일반 종료(전출 아님)는 종료일 당일까지 재원 — 두 규약이 다르다.
    const ended = [E("2026-03-01", "2026-08-19", false)];
    expect(cellStateOf({ enrollments: ended, withdrawnAt: null, date: "2026-08-19", attendance: null, hasReport: false })).toBe(
      "untracked",
    );
  });

  it("🔴 학원 퇴원은 수강에 종료일이 없어도 잡는다", () => {
    expect(
      cellStateOf({ enrollments: enr, withdrawnAt: "2026-08-10", date: "2026-08-19", attendance: null, hasReport: false }),
    ).toBe("off-roster");
    expect(
      cellStateOf({ enrollments: enr, withdrawnAt: "2026-08-10", date: "2026-08-05", attendance: null, hasReport: false }),
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
