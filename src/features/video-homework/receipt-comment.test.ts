import { expect, it } from "vitest";
import { videoReceiptComment, appendVideoReceiptComment } from "./receipt-comment";
import type { VideoArrival } from "./types";

const dates = ["2026-10-01", "2026-10-03", "2026-10-05"];
const video = (date: string, day = "2026-10-10"): VideoArrival => ({ id: date, studentId: "s", classId: "c", homeworkDate: date,
  postedAt: `${day}T12:00:00+09:00`, playback: { preview: "preview", thumbnail: "thumbnail", uploadedAt: null } });
const run = (homeworkDates: string[], videos: VideoArrival[]) => videoReceiptComment({ classId: "c", studentId: "s", homeworkDates, videos,
  reportDate: "2026-10-12", previousReportDate: "2026-10-08", fromDate: "2026-09-01" });

it("영상이 없으면 수동 체크와 관계없이 제출 멘트를 만들지 않는다", () => {
  expect(run(dates, [])).toBeNull();
  expect(run(dates, [{ ...video(dates[0]), playback: null }])).toBeNull();
});
it("한두 건만 낸 경우 '모두'라고 하지 않는다", () => {
  expect(run(dates.slice(0, 1), [video(dates[0])])).toBe("지난 영상 숙제도 제출했습니다.");
  expect(run(dates.slice(0, 2), dates.slice(0, 2).map(d => video(d)))).toBe("지난 영상 숙제도 제출했습니다.");
});
it("여러 숙제를 마무리했고 남은 숙제가 없을 때만 모두라고 한다", () => {
  expect(run(dates, dates.map(d => video(d)))).toBe("지난 영상 숙제를 모두 제출했습니다.");
  expect(run([...dates, "2026-10-07"], dates.map(d => video(d)))).toBe("지난 영상 숙제도 제출했습니다.");
});
it("조회 범위보다 오래된 숙제가 있으면 전부 제출했다고 단정하지 않는다", () => {
  expect(videoReceiptComment({ classId: "c", studentId: "s", homeworkDates: dates, videos: dates.map(d => video(d)),
    reportDate: "2026-10-12", previousReportDate: "2026-10-08", fromDate: "2026-09-01", historyComplete: false }))
    .toBe("지난 영상 숙제도 제출했습니다.");
});
it("지난 보고서 이전 제출·미래 업로드·다른 반 영상은 새 제출로 말하지 않는다", () => {
  for (const candidate of [video(dates[0], "2026-10-07"), video(dates[0], "2026-10-13"), { ...video(dates[0]), classId: "other" }])
    expect(run(dates, [candidate])).toBeNull();
});
it("지연 제출도 실제 영상이 있으면 반영하고 같은 숙제의 파일 여러 개는 한 건으로 본다", () => {
  expect(run([dates[0]], [video(dates[0]), { ...video(dates[0]), id: "second" }, { ...video(dates[0]), id: "third" }]))
    .toBe("지난 영상 숙제도 제출했습니다.");
});
it("지난 보고서를 보낸 날 그 뒤에 도착한 영상도 다음 멘트에 반영한다", () => {
  const input = { classId: "c", studentId: "s", homeworkDates: [dates[0]], reportDate: "2026-10-12",
    previousReportDate: "2026-10-08", previousReportAt: "2026-10-08T18:00:00+09:00", fromDate: "2026-09-01" };
  expect(videoReceiptComment({ ...input, videos: [{ ...video(dates[0]), postedAt: "2026-10-08T23:00:00+09:00" }] }))
    .toBe("지난 영상 숙제도 제출했습니다.");
  expect(videoReceiptComment({ ...input, videos: [{ ...video(dates[0]), postedAt: "2026-10-08T17:00:00+09:00" }] })).toBeNull();
});
it("뒤늦게 수집된 실제 파일을 반영하되 보고서 날짜 이후에 수집된 파일은 쓰지 않는다", () => {
  const delayed = { ...video(dates[0], "2026-10-07"), playback: { preview: "p", thumbnail: "t", uploadedAt: "2026-10-10T12:00:00+09:00" } };
  expect(run([dates[0]], [delayed])).toBe("지난 영상 숙제도 제출했습니다.");
  expect(run([dates[0]], [{ ...delayed, playback: { ...delayed.playback, uploadedAt: "2026-10-13T12:00:00+09:00" } }])).toBeNull();
});
it("기존 멘트를 보존하면서 제출 문장은 한 번만 붙인다", () => {
  const receipt = "지난 영상 숙제도 제출했습니다.";
  expect(appendVideoReceiptComment(`오늘 분수를 공부했습니다. ${receipt}`, receipt)).toBe(`오늘 분수를 공부했습니다. ${receipt}`);
  expect(appendVideoReceiptComment("오늘 분수를 공부했습니다.", null)).toBe("오늘 분수를 공부했습니다.");
});
it("🔴 옮겨 남긴 숙제는 장부와 같은 칸으로 짜되 댓글로 세지 않는다 — 그 칸을 고른 영상의 같은 날 사본이 정식 칸을 채우지 않는다", () => {
  // 남긴 숙제 10/01을 골라 올린 영상(10/10 12시) + 같은 날 뒤에 올린 ClassNote 사본(고른 숙제 없음) — 정식 숙제 10/03은 아직 안 냈다.
  const picked = video("2026-10-01");
  const copy: VideoArrival = { ...video("2026-10-01"), id: "copy", homeworkDate: null, postedAt: "2026-10-10T13:00:00+09:00" };
  const base = { classId: "c", studentId: "s", videos: [picked, copy], reportDate: "2026-10-12", previousReportDate: "2026-10-08", fromDate: "2026-09-01" };
  expect(videoReceiptComment({ ...base, homeworkDates: ["2026-10-03"], keptDates: ["2026-10-01"] })).toBeNull();
  // 남긴 숙제를 빼고 짜면(예전) 사본이 정식 10/03을 채워 "제출했습니다"가 붙었다
  expect(videoReceiptComment({ ...base, homeworkDates: ["2026-10-03"] })).toBe("지난 영상 숙제도 제출했습니다.");
});
