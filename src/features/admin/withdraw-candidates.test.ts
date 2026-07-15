import { describe, expect, it } from "vitest";
import {
  WITHDRAW_CANDIDATE_DAYS,
  isWithdrawCandidate,
  selectWithdrawCandidates,
} from "./withdraw-candidates";

// cutoff = 오늘(2026-07-15) - 30일
const CUTOFF = "2026-06-15";

describe("isWithdrawCandidate", () => {
  it("마지막 수강 종료가 30일보다 오래되면 후보", () => {
    expect(isWithdrawCandidate({ lastEndedAt: "2026-05-01" }, CUTOFF)).toBe(true);
  });

  it("cutoff 당일(정확히 30일)은 후보 — 경계 포함", () => {
    expect(isWithdrawCandidate({ lastEndedAt: CUTOFF }, CUTOFF)).toBe(true);
  });

  it("30일이 안 지났으면 후보 아님 — 반 폐지·종강 직후 재배정 대기 학생을 퇴원시키지 않는다", () => {
    expect(isWithdrawCandidate({ lastEndedAt: "2026-07-14" }, CUTOFF)).toBe(false);
  });

  it("오늘 반이 폐지돼 수강이 끊긴 학생은 후보 아님(핵심 회귀 — 즉시 퇴원 방지)", () => {
    expect(isWithdrawCandidate({ lastEndedAt: "2026-07-15" }, CUTOFF)).toBe(false);
  });

  it("기준일을 모르면(null) 후보 아님 — 증명 못 하면 안 건드린다", () => {
    expect(isWithdrawCandidate({ lastEndedAt: null }, CUTOFF)).toBe(false);
  });
});

describe("selectWithdrawCandidates", () => {
  it("후보만 입력 순서대로 남긴다", () => {
    const rows = [
      { id: "old", lastEndedAt: "2026-01-02" },
      { id: "fresh", lastEndedAt: "2026-07-15" },
      { id: "unknown", lastEndedAt: null },
      { id: "boundary", lastEndedAt: CUTOFF },
    ];
    expect(selectWithdrawCandidates(rows, CUTOFF).map((r) => r.id)).toEqual(["old", "boundary"]);
  });

  it("빈 입력은 빈 결과", () => {
    expect(selectWithdrawCandidates([], CUTOFF)).toEqual([]);
  });
});

it("게이트 기준은 30일", () => {
  expect(WITHDRAW_CANDIDATE_DAYS).toBe(30);
});
