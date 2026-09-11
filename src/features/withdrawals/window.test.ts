import { describe, expect, it } from "vitest";
import {
  countWithdrawalPrograms,
  inWithdrawalWindow,
  lastEndedByStudent,
  pickLastEnded,
  withdrawalMonthWindow,
  withdrawalProgram,
} from "./window";

describe("withdrawalMonthWindow — 이번 달 = 1일 ~ min(말일, 오늘)", () => {
  it("이번 달은 오늘까지 — 오늘 이후로 적힌 퇴원(예정)은 창 밖", () => {
    const win = withdrawalMonthWindow("2026-09", "2026-09-11");
    expect(win).toEqual({ from: "2026-09-01", to: "2026-09-11" });
    expect(inWithdrawalWindow({ withdrawnAt: "2026-09-11", systemBulk: false }, win.from, win.to)).toBe(true);
    expect(inWithdrawalWindow({ withdrawnAt: "2026-09-25", systemBulk: false }, win.from, win.to)).toBe(false);
  });
  it("지난 달은 말일까지, 미래 달은 빈 창", () => {
    expect(withdrawalMonthWindow("2026-08", "2026-09-11")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    const future = withdrawalMonthWindow("2026-10", "2026-09-11");
    expect(future.from > future.to).toBe(true);
  });
});

const SUBJECTS = [
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
  { key: "subject_1", label: "수학(심화)" },
];

describe("pickLastEnded — 마지막으로 끝난 수강", () => {
  it("종료일이 가장 늦은 줄 — 열린 수강은 후보가 아니다", () => {
    const last = pickLastEnded([
      { id: "1", end_date: "2026-07-01", start_date: "2026-03-02" },
      { id: "2", end_date: null, start_date: "2026-08-01" },
      { id: "3", end_date: "2026-09-02", start_date: "2026-03-02" },
    ]);
    expect(last?.id).toBe("3");
  });

  it("종료일이 같으면 시작일 → id로 결정적 — 입력 순서가 바뀌어도 같은 줄", () => {
    const rows = [
      { id: "b", end_date: "2026-09-02", start_date: "2026-03-02" },
      { id: "a", end_date: "2026-09-02", start_date: "2026-05-01" },
      { id: "c", end_date: "2026-09-02", start_date: "2026-05-01" },
    ];
    expect(pickLastEnded(rows)?.id).toBe("c");
    expect(pickLastEnded([...rows].reverse())?.id).toBe("c");
  });

  it("끝난 수강이 없으면 null", () => {
    expect(pickLastEnded([{ id: "1", end_date: null }])).toBeNull();
    expect(pickLastEnded([])).toBeNull();
  });

  it("학생별로 고른다", () => {
    const map = lastEndedByStudent([
      { id: "1", student_id: "s1", end_date: "2026-07-01" },
      { id: "2", student_id: "s1", end_date: "2026-08-01" },
      { id: "3", student_id: "s2", end_date: null },
    ]);
    expect(map.get("s1")?.id).toBe("2");
    expect(map.has("s2")).toBe(false);
  });
});

describe("inWithdrawalWindow — 기간 안 퇴원", () => {
  it("양끝 포함(YYYY-MM-DD)", () => {
    expect(inWithdrawalWindow({ withdrawnAt: "2026-09-01", systemBulk: false }, "2026-09-01", "2026-09-30")).toBe(true);
    expect(inWithdrawalWindow({ withdrawnAt: "2026-09-30", systemBulk: false }, "2026-09-01", "2026-09-30")).toBe(true);
    expect(inWithdrawalWindow({ withdrawnAt: "2026-08-31", systemBulk: false }, "2026-09-01", "2026-09-30")).toBe(false);
    expect(inWithdrawalWindow({ withdrawnAt: "2026-10-01", systemBulk: false }, "2026-09-01", "2026-09-30")).toBe(false);
  });

  it("🔴 시스템 정리(퇴원일 미상)·날짜 없음은 어느 달에도 안 든다", () => {
    expect(inWithdrawalWindow({ withdrawnAt: "2026-07-10", systemBulk: true }, "2026-07-01", "2026-07-31")).toBe(false);
    expect(inWithdrawalWindow({ withdrawnAt: null, systemBulk: false }, "2026-07-01", "2026-07-31")).toBe(false);
  });
});

describe("퇴원생 프로그램 = 마지막 수강 반", () => {
  it("영어 반은 트랙으로, 수학(심화)는 수학, 그 외·미상은 null", () => {
    expect(withdrawalProgram({ lastClassSubject: "english", lastClassEnglishTrack: "eie" }, SUBJECTS)).toBe("eie");
    expect(withdrawalProgram({ lastClassSubject: "english", lastClassEnglishTrack: null }, SUBJECTS)).toBe("injaewon");
    expect(withdrawalProgram({ lastClassSubject: "english" }, SUBJECTS)).toBe("injaewon");
    expect(withdrawalProgram({ lastClassSubject: "subject_1" }, SUBJECTS)).toBe("math");
    expect(withdrawalProgram({ lastClassSubject: "science" }, SUBJECTS)).toBeNull();
    expect(withdrawalProgram({ lastClassSubject: null }, SUBJECTS)).toBeNull();
  });

  it("🔑 한 학생 = 프로그램 하나 → 프로그램별 합(기타·미상 포함) = 퇴원생 수", () => {
    const counts = countWithdrawalPrograms([
      { program: "eie" },
      { program: "math" },
      { program: "math" },
      { program: null },
      { program: "injaewon" },
    ]);
    expect(counts).toEqual({ eie: 1, injaewon: 1, math: 2, other: 1, total: 5 });
    expect(counts.eie + counts.injaewon + counts.math + counts.other).toBe(counts.total);
  });
});
