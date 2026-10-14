import { describe, expect, it } from "vitest";
import { blankCells, blankReasonOn, buildBlankFacts, ledgerRowCells, type BlankAttendanceRow } from "./no-homework";
import { roundSource } from "./ledger";
import type { LedgerRound } from "./rounds";
import type { LedgerEnrollment } from "./ledger-roster";

const enroll = (patch: Partial<LedgerEnrollment> = {}): LedgerEnrollment =>
  ({ class_id: "A", student_id: "s1", start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false, attendance_days: null, ...patch });
const rec = (date: string, status: string, extra: Partial<BlankAttendanceRow> = {}): BlankAttendanceRow =>
  ({ id: `r-${date}-${status}`, student_id: "s1", class_id: "A", session_date: date, slot_start: null, status, recorded_at: `${date}T01:00:00Z`, ...extra });

describe("빈 칸 사유 판정 — 출석부와 같은 출결 접기", () => {
  it("결석·공결 = 결석, 출석·지각·조퇴 기록 = 숙제없음", () => {
    expect(blankReasonOn("2026-10-06", [enroll()], [{ status: "absent" }])).toBe("absent");
    expect(blankReasonOn("2026-10-06", [enroll()], [{ status: "excused" }])).toBe("absent");
    expect(blankReasonOn("2026-10-06", [enroll()], [{ status: "late" }])).toBe("none");
    expect(blankReasonOn("2026-10-06", [enroll()], [{ status: "early_leave" }])).toBe("none");
  });
  it("기록이 없으면 수강 중일 때만 숙제없음 — 입반 전·퇴원 후·분리등원 밖 요일·휴원은 null('—')", () => {
    expect(blankReasonOn("2026-10-06", [enroll()], [])).toBe("none");
    expect(blankReasonOn("2026-08-25", [enroll()], [])).toBeNull(); // 입반 전
    expect(blankReasonOn("2026-10-06", [enroll({ end_date: "2026-09-20" })], [])).toBeNull(); // 퇴원 후
    expect(blankReasonOn("2026-10-06", [enroll({ attendance_days: ["thu"] })], [])).toBeNull(); // 2026-10-06 = 화
    expect(blankReasonOn("2026-10-06", [enroll({ on_hold: true })], [])).toBeNull();
    expect(blankReasonOn("2026-10-06", [], [])).toBeNull();
  });
  it("🔴 같은 날 교시 둘이 결석 + 출석이면 출석부 접기대로 결석이 아니다(하나라도 들었으면) — 결석 + 보강은 보강이 결석을 메우지 못해 결석", () => {
    expect(blankReasonOn("2026-10-06", [enroll()], [{ status: "absent" }, { status: "present" }])).toBe("none");
    expect(blankReasonOn("2026-10-06", [enroll()], [{ status: "absent" }, { status: "late" }])).toBe("none");
    expect(blankReasonOn("2026-10-06", [enroll()], [{ status: "absent" }, { status: "makeup" }])).toBe("absent");
    expect(blankReasonOn("2026-10-06", [enroll()], [{ status: "makeup" }])).toBe("none");
  });
});

describe("buildBlankFacts — 정정 최신본 · 보강은 결석을 메우지 않는다", () => {
  const targets = [{ classId: "A", studentId: "s1", dates: ["2026-10-06", "2026-10-08", "2026-08-20"] }];
  it("결석 뒤 출석으로 고친 정정본은 숙제없음, 보강 기록이 따로 있어도 결석 칸은 결석", () => {
    const facts = buildBlankFacts({ targets, enrollments: [enroll()], records: [
      rec("2026-10-06", "absent", { recorded_at: "2026-10-06T01:00:00Z", id: "1" }),
      rec("2026-10-06", "present", { recorded_at: "2026-10-07T01:00:00Z", id: "2" }),
      rec("2026-10-08", "absent"),
      rec("2026-10-13", "makeup"), // 보강일 자기 칸(결석 칸 아님)
    ] });
    expect(facts["A:s1"]).toEqual({ "2026-10-06": "none", "2026-10-08": "absent" }); // 8/20은 입반 전 → 키 없음
  });
});

describe("blankCells — 반 숙제 날짜 중 이 학생에게 없는 날을 날짜순으로 빈 칸에", () => {
  const facts = { "2026-10-06": "absent", "2026-10-13": "none", "2026-10-20": "none" } as const;
  it("자기 회차인 날은 건너뛰고, 사유가 없는 날(수강생 아님)도 건너뛰며, 빈 칸 수만큼만", () => {
    const own = [{ homeworkDate: "2026-10-13" }];
    const classDates = ["2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20"];
    expect(blankCells({ classDates, own, facts, slots: 2 })).toEqual([{ date: "2026-10-06", reason: "absent" }, { date: "2026-10-20", reason: "none" }]);
    expect(blankCells({ classDates, own, facts, slots: 1 })).toEqual([{ date: "2026-10-06", reason: "absent" }]);
    expect(blankCells({ classDates, own, facts: undefined, slots: 2 })).toEqual([]);
    expect(blankCells({ classDates, own, facts, slots: 0 })).toEqual([]);
  });
});

// 원장 2026-10-14 *"날짜 순서가 이상한데"* — 전주율: 10/1 숙제없음이 10/8·10/12 회차 뒤에 섰다.
describe("ledgerRowCells — 회차와 빈 칸을 날짜순으로 섞는다", () => {
  const round = (date: string) => ({ key: `h:${date}`, date, homeworkDate: date }) as LedgerRound;
  it("빈 칸이 회차보다 이르면 앞에 · 사이면 사이에 · 회차 차례와 수는 그대로", () => {
    const own = [round("2026-10-08"), round("2026-10-12")];
    const cells = ledgerRowCells(own, [{ date: "2026-10-01", reason: "none" }, { date: "2026-10-10", reason: "absent" }]);
    expect(cells.map((cell) => cell.round?.date ?? `빈 ${cell.blank?.date}`)).toEqual(["빈 2026-10-01", "2026-10-08", "빈 2026-10-10", "2026-10-12"]);
    expect(ledgerRowCells(own, []).map((cell) => cell.round)).toEqual(own);
    expect(ledgerRowCells([], [{ date: "2026-10-01", reason: "none" }])).toEqual([{ blank: { date: "2026-10-01", reason: "none" } }]);
  });
});

describe("완료 칸 표시 — 영상 ▶ · 수동", () => {
  it("영상이 짝지어졌으면 video, 영상 없이 찍은 완료는 manual, 완료가 아니면 없음", () => {
    expect(roundSource({ status: "submitted", videoId: "v" })).toBe("video");
    expect(roundSource({ status: "submitted", videoId: null })).toBe("manual");
    expect(roundSource({ status: "missing", videoId: null })).toBeNull();
    expect(roundSource({ status: "unchecked", videoId: null })).toBeNull();
  });
});
