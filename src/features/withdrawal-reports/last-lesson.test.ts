import { describe, expect, it } from "vitest";
import { lastAttendedDate, lastAttendedSettled, lastLessonHint, type LastLessonRow } from "./last-lesson";

let seq = 0;
const row = (session_date: string, status: string, over: Partial<LastLessonRow> = {}): LastLessonRow => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, student_id: "s", class_id: "c1", session_date, slot_start: null,
  status, recorded_at: `${session_date}T10:00:00Z`, ...over,
});

describe("마지막 수업일 — 출결 기준(원장 2026-11-03)", () => {
  it("고른 반의 출석·지각·조퇴·보강 중 가장 늦은 날 · 결석·공결은 들은 날이 아니다", () => {
    const rows = [row("2026-10-20", "present"), row("2026-10-27", "late"), row("2026-10-29", "absent"), row("2026-10-30", "excused")];
    expect(lastAttendedDate(rows, ["c1"], "2026-11-03")).toBe("2026-10-27");
    expect(lastAttendedDate([row("2026-10-28", "early_leave"), row("2026-10-31", "makeup")], ["c1"], "2026-11-03")).toBe("2026-10-31");
  });
  it("정정이 반영된 마지막 기록으로 본다 — 출석을 결석으로 고친 날은 빠지고, 결석을 출석으로 고친 날은 든다", () => {
    const rows = [
      row("2026-10-30", "present", { recorded_at: "2026-10-30T10:00:00Z" }), row("2026-10-30", "absent", { recorded_at: "2026-10-30T12:00:00Z" }),
      row("2026-10-23", "absent", { recorded_at: "2026-10-23T10:00:00Z" }), row("2026-10-23", "present", { recorded_at: "2026-10-24T09:00:00Z" }),
    ];
    expect(lastAttendedDate(rows, ["c1"], "2026-11-03")).toBe("2026-10-23");
  });
  it("같은 날 교시가 다르면 따로 센다 · 고르지 않은 반·오늘 뒤 기록은 빼고 · 없으면 null", () => {
    const rows = [row("2026-10-30", "absent", { slot_start: "14:00" }), row("2026-10-30", "present", { slot_start: "16:00" })];
    expect(lastAttendedDate(rows, ["c1"], "2026-11-03")).toBe("2026-10-30");
    expect(lastAttendedDate([row("2026-10-30", "present", { class_id: "c2" })], ["c1"], "2026-11-03")).toBeNull();
    expect(lastAttendedDate([row("2026-11-05", "present")], ["c1"], "2026-11-03")).toBeNull();
    expect(lastAttendedDate([], ["c1"], "2026-11-03")).toBeNull();
  });
  it("여러 반이면 그중 가장 늦은 날", () => {
    expect(lastAttendedDate([row("2026-10-20", "present"), row("2026-10-25", "present", { class_id: "c2" })], ["c1", "c2"], "2026-11-03")).toBe("2026-10-25");
  });
  it("늦은 순으로 받다 멈춰도 되는가 — 답이 된 날보다 이른 줄까지 왔거나 다 받았을 때만", () => {
    const page = [row("2026-10-31", "absent"), row("2026-10-30", "present")];
    expect(lastAttendedSettled(page, ["c1"], "2026-11-03", false)).toEqual({ date: "2026-10-30", settled: false });
    expect(lastAttendedSettled([...page, row("2026-10-29", "present")], ["c1"], "2026-11-03", false)).toEqual({ date: "2026-10-30", settled: true });
    expect(lastAttendedSettled([row("2026-10-31", "absent")], ["c1"], "2026-11-03", false)).toEqual({ date: null, settled: false });
    expect(lastAttendedSettled([row("2026-10-31", "absent")], ["c1"], "2026-11-03", true)).toEqual({ date: null, settled: true });
  });
  it("칸 아래 안내 — 출결 기준 / 출결 기록 없음 → 오늘", () => {
    expect(lastLessonHint("attendance")).toContain("출결 기준");
    expect(lastLessonHint("none")).toBe("출결 기록 없음 → 오늘");
  });
});
