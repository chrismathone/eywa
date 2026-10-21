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
it("🔴 숙제 없이 올린 영상(free · 메모)은 남은 숙제를 자동으로 채우지 않는다 — 미배정으로 알리고, 손으로 배정하면 그 숙제 칸으로", () => {
  const free = video("free", "2026-10-09", { free: true });
  const result = run([free]);
  expect(result.outcomes.map(o => o.status)).toEqual(["missing", "unchecked"]); // 10/1 숙제가 '제출'로 바뀌지 않는다
  expect(result.unmatched.map(v => v.id)).toEqual(["free"]);
  const assigned = run([{ ...free, homeworkDate: "2026-10-08", manuallyAssigned: true }]);
  expect(assigned.outcomes.map(o => o.videoId)).toEqual([null, "free"]);
  expect(assigned.unmatched).toEqual([]);
});
it("🔴 옮겨 남긴 숙제·검사 기록 칸은 판정하지 않는다 — 그 칸이 뒷순위로 받은 영상만 미배정에서 뺀다(장부와 같은 말)", () => {
  const kept = { classId: "math", studentId: "s1", date: "2026-09-24", kept: true as const };
  const mark = { classId: "math", studentId: "s1", checkDate: "2026-09-29", homeworkDate: "2026-09-28", status: "missing" as const };
  // 9/25 영상 = 남긴 9/24 칸 · 9/29 영상 = 기록 9/28 칸(둘 다 10/01 숙제보다 먼저라 정식 칸에는 못 간다) · 10/02 영상 = 정식 10/01 칸
  const result = videoHomeworkOutcomes([kept, ...assignments], [video("a", "2026-09-25"), video("b", "2026-09-29"), video("c", "2026-10-02")],
    "2026-10-05", "2026-09-01", [mark]);
  expect(result.outcomes.map(o => [o.homeworkDate, o.videoId])).toEqual([["2026-10-01", "c"]]);
  expect(result.unmatched.map(v => v.id)).toEqual([]);
  // 기록·남긴 숙제를 안 넘기면 종전대로 미배정
  expect(videoHomeworkOutcomes(assignments, [video("b", "2026-09-29")], "2026-10-05", "2026-09-01").unmatched.map(v => v.id)).toEqual(["b"]);
});
it("🔴 옮겨 남긴 더 오래된 빈 숙제가 정식 칸의 영상을 가져가지 않는다(적대적 리뷰 2026-10-13)", () => {
  const kept = { classId: "math", studentId: "s1", date: "2026-09-24", kept: true as const };
  const result = videoHomeworkOutcomes([kept, ...assignments], [video("c", "2026-10-02")], "2026-10-12", "2026-09-01");
  expect(result.outcomes.map(o => [o.homeworkDate, o.status, o.videoId])).toEqual([["2026-10-01", "submitted", "c"], ["2026-10-08", "unchecked", null]]);
});
// 원장 2026-10-15 — 선생님이 고른 마감('다음 수업')이 미수행을 가르는 날이다(DB 함수 reconcile_video_homework_outcomes와 같은 규칙).
it("마감을 고른 숙제는 그 날까지 미확인, 다음 날부터 미제출 — 7일보다 이르든 늦든", () => {
  const withDue = [{ classId: "math", studentId: "s1", date: "2026-10-01", due: "2026-10-03" }, { classId: "math", studentId: "s1", date: "2026-10-08", due: "2026-10-20" }];
  const at = (today: string) => videoHomeworkOutcomes(withDue, [], today, "2026-09-01").outcomes.map(o => o.status);
  expect(at("2026-10-03")).toEqual(["unchecked"]);
  expect(at("2026-10-04")).toEqual(["missing"]);
  expect(at("2026-10-16")).toEqual(["missing", "unchecked"]);
  expect(at("2026-10-20")).toEqual(["missing", "unchecked"]);
  expect(at("2026-10-21")).toEqual(["missing", "missing"]);
});
it("🔴 옮겨 남긴 숙제에 둘째 영상을 골라 내도 미배정 알림에 서지 않는다(한 숙제에 여러 개 — 적대적 리뷰 2026-10-21)", () => {
  const kept = { classId: "math", studentId: "s1", date: "2026-09-24", kept: true as const };
  const result = videoHomeworkOutcomes([kept, ...assignments], [
    video("k1", "2026-09-25", { homeworkDate: "2026-09-24" }), video("k2", "2026-09-26", { homeworkDate: "2026-09-24" }),
  ], "2026-10-05", "2026-09-01");
  expect(result.unmatched.map(v => v.id)).toEqual([]);
});
