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
it("기존 멘트를 보존하면서 제출 문장은 한 번만 붙인다", () => {
  const receipt = "지난 영상 숙제도 제출했습니다.";
  expect(appendVideoReceiptComment(`오늘 분수를 공부했습니다. ${receipt}`, receipt)).toBe(`오늘 분수를 공부했습니다. ${receipt}`);
  expect(appendVideoReceiptComment("오늘 분수를 공부했습니다.", null)).toBe("오늘 분수를 공부했습니다.");
});
