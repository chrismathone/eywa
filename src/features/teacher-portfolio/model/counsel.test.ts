import { describe, expect, it } from "vitest";
import { counselItem } from "./counsel";
import type { PortfolioSnapshot, SnapshotConsultation } from "./types";

/** 원생상담 — 담당 학생 중 본인이 이 달에 1회 이상 상담한 비율(원장 2026-10-14). */
const w = { month: "2026-10", start: "2026-10-01", end: "2026-10-31", partial: false };
const consult = (student: string, at: string, counselor = "t"): SnapshotConsultation => ({
  id: `${student}|${at}|${counselor}`, student_id: student, counselor_id: counselor, consulted_at: at, follow_up_date: null, follow_up_done: null, updated_at: null,
});
const run = (consultations: SnapshotConsultation[], students = ["a", "b", "c", "d"]) => counselItem({
  d: { consultations } as unknown as PortfolioSnapshot, teacherId: "t", w, classNameOf: (id) => id,
  roster: () => new Map(students.map((s) => [s, {
    classes: new Set(s === "both" ? ["c1", "jj"] : [s === "sub" ? "jj" : "c1"]), homeClasses: new Set(s === "sub" ? [] : ["c1"]),
    roles: new Set<"담임" | "부담임">(s === "sub" ? ["부담임"] : s === "both" ? ["담임", "부담임"] : ["담임"]),
  }])),
});

describe("원생상담 = 담당 학생 상담 비율", () => {
  it("전원 1회 이상이면 100%, 여러 번 상담해도 한 명 · 다른 사람이 한 상담·다른 달 상담은 세지 않는다", () => {
    expect(run(["a", "b", "c", "d"].map((s) => consult(s, "2026-10-05T01:00:00Z"))).raw).toBe(100);
    const m = run([
      consult("a", "2026-10-05T01:00:00Z"), consult("a", "2026-10-20T01:00:00Z"),
      consult("b", "2026-10-06T01:00:00Z", "other"), consult("c", "2026-09-30T14:00:00Z"), consult("d", "2026-09-30T15:00:00Z"),
    ]);
    // a(두 번) · d(한국 시간 10/1 00:00) = 2명 / 4명. b는 다른 사람, c는 한국 시간 9/30.
    expect([m.consulted, m.total, m.raw]).toEqual([2, 4, 50]);
    expect(m.detail.find((r) => r.studentId === "a")?.day).toBe("2026-10-05");
    expect(m.detail[0].consulted).toBe(false);
  });
  it("부담임으로만 맡은 학생은 빼고 담임 반 학생만 센다(원장 2026-10-14)", () => {
    const m = run([consult("a", "2026-10-05T01:00:00Z")], ["a", "sub", "both"]);
    expect([m.consulted, m.total, m.raw]).toEqual([1, 2, 50]);
    // 담임 반과 부담임 반(JJ)을 함께 듣는 학생도 반 이름은 담임 반만.
    expect(m.detail.find((r) => r.studentId === "both")?.className).toBe("c1");
  });
  it("담당 학생이 없으면 자료 없음", () => {
    expect(run([], []).raw).toBeNull();
  });
});
