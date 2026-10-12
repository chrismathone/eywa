import { expect, it } from "vitest";
import { videoHomeworkOutcomes } from "./auto-outcomes";
import type { VideoArrival } from "./types";

const assignments = ["2026-10-01", "2026-10-08"].map(date => ({ classId: "math", studentId: "s1", date }));
const video = (id: string, day: string, extra: Partial<VideoArrival> = {}): VideoArrival => ({
  id, classId: "math", studentId: "s1", postedAt: `${day}T12:00:00+09:00`,
  playback: { preview: "preview", thumbnail: "thumbnail", uploadedAt: `${day}T12:00:00+09:00` }, ...extra,
});
const run = (videos: VideoArrival[], today = "2026-10-12") => videoHomeworkOutcomes(assignments, videos, today, "2026-09-01");

it("7일째 자정까지 미확인, 8일째부터 미제출 — 실제 파일이 오면 제출", () => {
  expect(run([], "2026-10-08").outcomes[0].status).toBe("unchecked");
  expect(run([], "2026-10-09").outcomes[0].status).toBe("missing");
  expect(run([video("late", "2026-10-10", { homeworkDate: "2026-10-01" })]).outcomes.map(o => o.status)).toEqual(["submitted", "unchecked"]);
});
it("댓글·로그인의 지정 숙제부터 연결하고 게시글은 남은 숙제에 한 번만 배정", () => {
  const result = run([video("post", "2026-10-09"), video("comment", "2026-10-10", { homeworkDate: "2026-10-08" })]);
  expect(result.outcomes.map(o => o.videoId)).toEqual(["post", "comment"]);
  expect(result.unmatched).toEqual([]);
});
it("다른 반·학생·과거 날짜·14일 초과·업로드 실패는 완료 근거가 아니다", () => {
  for (const candidate of [video("v", "2026-09-30"), video("v", "2026-10-23"),
    video("v", "2026-10-09", { classId: "english" }), video("v", "2026-10-09", { studentId: "s2" }),
    video("v", "2026-10-09", { playback: null }), video("v", "2026-10-09", { homeworkDate: "invalid" })]) {
    expect(run([candidate]).outcomes.some(o => o.videoId), candidate.id).toBe(false);
  }
});
it("미분류 영상은 당일에는 알리지 않고 다음날 미배정 목록에 포함", () => {
  const candidate = video("unknown", "2026-10-11", { classId: null, arrivedAt: "2026-10-12T00:10:00+09:00" });
  expect(run([candidate], "2026-10-11").unmatched).toEqual([]);
  expect(run([candidate], "2026-10-12").unmatched.map(v => v.id)).toEqual(["unknown"]);
});
it("명시적으로 같은 숙제에 낸 추가 파일과 같은 파일 사본을 미배정으로 알리지 않는다", () => {
  const result = run([video("chosen", "2026-10-10", { homeworkDate: "2026-10-08", fingerprint: "same" }),
    video("extra", "2026-10-10", { homeworkDate: "2026-10-08" }), video("copy", "2026-10-10", { fingerprint: "same" })]);
  expect(result.outcomes.map(o => o.videoId)).toEqual([null, "chosen"]);
  expect(result.unmatched).toEqual([]);
});
