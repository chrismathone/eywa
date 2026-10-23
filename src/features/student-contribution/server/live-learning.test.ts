import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ grades: vi.fn(), videos: vi.fn() }));
vi.mock("@/features/grades/unified/server/queries", () => ({ getUnifiedGrades: m.grades }));
vi.mock("@/features/students/server/homework-videos", () => ({ getStudentHomeworkVideos: m.videos }));
import { readLiveGrades, readLiveVideos } from "./live-learning";
import type { LiveContext } from "./live-context";
const c = { tenant: "t", studentId: "s", today: "2026-10-23" } as LiveContext;
it("uses unified grade sources, date bounds and original score units", async () => {
  const base = { studentId: "s", date: "2026-10-22", score: 18, maxScore: 20, rawScore: null };
  m.grades.mockResolvedValue({ records: [
    { ...base, key: "r:daily", sourceId: "r", source: "report", kind: "daily" },
    { ...base, key: "g", sourceId: "g", source: "grade", kind: "monthly" },
    { ...base, key: "old", sourceId: "old", source: "grade", kind: "monthly", date: "2026-01-01" },
    { ...base, key: "other", sourceId: "other", source: "grade", kind: "monthly", studentId: "other" },
  ] });
  const result = await readLiveGrades(c);
  expect(m.grades).toHaveBeenCalledWith("2026-07-26", c.today, { studentId: "s" });
  expect(result.total).toBe(2);
  expect(result.items.map((r) => r.detail).sort()).toEqual(["18개 / 20개", "18점 / 20점"]);
  expect(result.items.map((r) => r.evidence[0].source).sort()).toEqual(["lesson_reports", "student_grades"]);
});
it("does not turn missing scores into zero or an unexamined test into absence", async () => {
  m.grades.mockResolvedValue({ records: [{ studentId: "s", key: "g", sourceId: "g", source: "grade", kind: "school", date: c.today, score: null, maxScore: null, noExam: true }] });
  expect((await readLiveGrades(c)).items[0].detail).toBe("시험 없음으로 기록");
});
it("retains source failure rather than empty grade success", async () => {
  m.grades.mockRejectedValue(new Error("offline"));
  expect(await readLiveGrades(c)).toMatchObject({ state: "failed", total: null, items: [] });
});
it("uses the original deduplicated video list without declaring homework completed", async () => {
  m.videos.mockResolvedValue({ ready: true, rows: [{ id: "v", status: "uploaded", subject: "math", created_at: c.today, posted_at: null, comment_id: null }] });
  const result = await readLiveVideos(c);
  expect(result.total).toBe(1); expect(result.items[0].detail).not.toContain("숙제 완료");
});
