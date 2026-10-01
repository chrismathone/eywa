import { describe, expect, it } from "vitest";
import { pickLessonMarks } from "./lesson-marks";
import type { VideoHomeworkMark } from "./types";

const today = "2026-10-08";
const m = (studentId: string, checkDate: string, homeworkDate: string | null, status: VideoHomeworkMark["status"] = "submitted"): VideoHomeworkMark =>
  ({ classId: "A", studentId, checkDate, homeworkDate, status });

describe("원스크린 '지난 수업 영상 숙제' 칸의 기록 — 같은 숙제 = 한 칸", () => {
  it("영상 제출 현황에서 먼저 찍은 같은 숙제의 기록(다른 자리)을 이 칸에 세운다", () => {
    const ledger = m("s1", "2026-10-07", "2026-10-06");
    expect(pickLessonMarks([ledger], [{ classId: "A", studentId: "s1", homeworkDate: "2026-10-06" }], today)).toEqual([ledger]);
  });
  it("오늘 찍은 기록과 같은 숙제면 오늘 것이 먼저 · 숙제일이 달라도 오늘 찍은 기록은 남긴다(예전 동작)", () => {
    const own = m("s1", today, "2026-10-06", "missing");
    const ledger = m("s1", "2026-10-07", "2026-10-06");
    const other = m("s2", today, "2026-10-01");
    const picked = pickLessonMarks([ledger, own, other], [
      { classId: "A", studentId: "s1", homeworkDate: "2026-10-06" }, { classId: "A", studentId: "s2", homeworkDate: "2026-10-06" }], today);
    expect(picked).toEqual([own, other]);
  });
  it("지난 수업일을 모르는 행·숙제일 없는 옛 기록은 예전처럼 오늘 자리의 기록을 쓴다", () => {
    const legacy = m("s1", today, null);
    const unknown = m("s2", today, "2026-10-01");
    expect(pickLessonMarks([legacy, unknown], [
      { classId: "A", studentId: "s1", homeworkDate: "2026-10-06" }, { classId: "A", studentId: "s2", homeworkDate: null }], today)).toEqual([legacy, unknown]);
  });
  it("원스크린에 없는 반·학생의 오늘 기록은 그대로 둔다(예전 동작) · 다른 날 기록은 버린다", () => {
    const loose = m("s9", today, "2026-10-06");
    expect(pickLessonMarks([loose, m("s9", "2026-10-01", "2026-09-30")], [], today)).toEqual([loose]);
  });
});
