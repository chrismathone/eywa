import { describe, expect, it } from "vitest";
import { lastAttendedDate, lastAttendedSettled, lastLessonHint, lastLessonNeedsCheck, lastLessonReloadable, type LastLessonRow } from "./last-lesson";

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
  it("칸 아래 안내 — 출결 기준 / 못 찾으면 까닭별 알림(원장 2026-11-05 '조회되지 않는다는 알림문구')", () => {
    expect(lastLessonHint("attendance")).toContain("출결 기준");
    expect(lastLessonHint("none")).toBe("고른 반에서 출석 기록을 찾지 못했습니다 — 마지막 수업일을 직접 확인해 입력해 주세요(지금은 오늘 날짜).");
    expect(lastLessonHint("nocourses")).toContain("다니는 반이 없어 출결에서 찾을 수 없습니다");
    expect(lastLessonHint("denied")).toContain("출결을 볼 권한이 없어");
    expect(lastLessonHint("error")).toContain("출결을 불러오지 못했습니다");
    const reasons = (["none", "nocourses", "denied", "error"] as const).map(s => lastLessonHint(s));
    expect(new Set(reasons).size).toBe(4);
    for (const s of ["none", "nocourses", "denied", "error"] as const) expect(lastLessonNeedsCheck(s)).toBe(true);
    // 반을 고르는 중(반이 있는 원생이 모두 끔)은 경고가 아니라 흐린 안내(리뷰 2026-11-06).
    expect(lastLessonHint("unselected")).toBe("종료할 반을 고르면 출결에서 찾습니다");
    for (const s of ["today", "loading", "attendance", "manual", "unselected"] as const) expect(lastLessonNeedsCheck(s)).toBe(false);
  });
  it("다시 불러오기가 날짜를 못 얻으면 '그대로 두었다'고 적는다 — '(지금은 오늘 날짜)'가 아니다(리뷰 2026-11-06)", () => {
    for (const s of ["none", "denied", "error"] as const) {
      expect(lastLessonHint(s, true)).toContain("마지막 수업일 칸의 날짜를 그대로 두었습니다");
      expect(lastLessonHint(s, true)).not.toContain("오늘 날짜");
    }
    expect(new Set((["none", "denied", "error"] as const).map(s => lastLessonHint(s, true))).size).toBe(3);
  });
  it("'출결에서 다시 불러오기' 단추 — 손으로 고쳤거나 오류일 때 · 다시 부르는 중엔 보이되(꺼 둔다) 처음 찾는 중엔 숨긴다 · 권한 없음을 받았으면 숨긴다", () => {
    expect(lastLessonReloadable("manual")).toBe(true);
    expect(lastLessonReloadable("error")).toBe(true);
    expect(lastLessonReloadable("loading", true)).toBe(true);
    for (const s of ["today", "loading", "attendance", "none", "nocourses", "unselected", "denied"] as const) expect(lastLessonReloadable(s)).toBe(false);
    for (const s of ["manual", "error"] as const) expect(lastLessonReloadable(s, false, true)).toBe(false);
    expect(lastLessonReloadable("loading", true, true)).toBe(false);
  });
});
