import { describe, expect, it } from "vitest";
import { buildLedgerRounds, markIdentity, roundCounts, roundWriteKey, VIDEO_MATCH_WINDOW_DAYS, videoMatchRange } from "./rounds";
import type { VideoArrival, VideoHomeworkMark } from "./types";

const row = (studentId: string, assignedDates: string[], extra: { classId?: string; tracked?: boolean } = {}) =>
  ({ classId: extra.classId ?? "A", studentId, assignedDates, tracked: extra.tracked ?? true });
const mark = (studentId: string, homeworkDate: string | null, status: VideoHomeworkMark["status"], extra: Partial<VideoHomeworkMark> = {}): VideoHomeworkMark =>
  ({ classId: "A", studentId, checkDate: homeworkDate ? "2026-10-20" : "2026-10-05", homeworkDate, status, ...extra });
// 원스크린 체크는 실제 검사 시각이 남는다 — 기본은 한참 뒤(영상 게시 이후)라 '그 검사가 본 영상' 판정이 켜지지 않는다.
const kst = (day: string, time = "20:00") => `${day}T${time}:00+09:00`;
const video = (studentId: string, day: string, extra: { classId?: string | null; time?: string; homeworkDate?: string } = {}): VideoArrival =>
  ({ id: `v-${studentId}-${day}-${extra.time ?? "20:00"}`, studentId, classId: extra.classId === undefined ? "A" : extra.classId, postedAt: kst(day, extra.time),
    ...(extra.homeworkDate ? { homeworkDate: extra.homeworkDate } : {}) });
const build = (input: { rows: ReturnType<typeof row>[]; marks?: VideoHomeworkMark[]; videos?: VideoArrival[]; from?: string; to?: string }) =>
  buildLedgerRounds({ rows: input.rows, marks: input.marks ?? [], videos: input.videos ?? [], fromDate: input.from ?? "2026-10-01", toDate: input.to ?? "2026-10-31" });
const view = (rounds: ReturnType<typeof build>, pair = "A:s1") =>
  (rounds.get(pair) ?? []).map((r) => [r.date, r.status, r.submittedDate, r.auto]);

describe("회차 = 숙제가 나간 수업만(원장 2026-10-01)", () => {
  it("학생마다 숙제가 나간 날을 순서대로 센다 — 같은 1회라도 날짜가 다를 수 있다", () => {
    const rounds = build({ rows: [row("s1", ["2026-10-06", "2026-10-01"]), row("s2", ["2026-10-08"])] });
    expect(view(rounds)).toEqual([["2026-10-01", "unchecked", null, false], ["2026-10-06", "unchecked", null, false]]);
    expect(view(rounds, "A:s2")).toEqual([["2026-10-08", "unchecked", null, false]]);
  });
  it("검사 기록은 같은 숙제 칸에 붙고, 보고서 표시가 없는 옛 기록도 회차로 남는다(숙제일 → 없으면 검사일)", () => {
    const rounds = build({ rows: [row("s1", ["2026-10-06"])], marks: [
      mark("s1", "2026-10-06", "missing"),
      mark("s1", "2026-10-02", "submitted", { submittedDate: "2026-10-03" }),
      mark("s1", null, "submitted", { checkDate: "2026-10-04" }),
    ] });
    expect(view(rounds)).toEqual([
      ["2026-10-02", "submitted", "2026-10-03", false], ["2026-10-04", "submitted", null, false], ["2026-10-06", "missing", null, false]]);
    expect(rounds.get("A:s1")!.map((r) => r.assigned)).toEqual([false, false, true]);
  });
  it("같은 숙제에 기록이 둘이면(옛 중복) 나중에 찍은 쪽", () => {
    const rounds = build({ rows: [row("s1", ["2026-10-06"])], marks: [
      mark("s1", "2026-10-06", "missing", { updatedAt: "2026-10-08T01:00:00Z" }),
      mark("s1", "2026-10-06", "submitted", { checkDate: "2026-10-07", updatedAt: "2026-10-09T01:00:00Z" }),
    ] });
    expect(view(rounds)).toEqual([["2026-10-06", "submitted", null, false]]);
  });
  it("숙제일 없는 옛 기록은 검사일 전 마지막 숙제의 기록 — 한 숙제를 두 번 세지 않고, 저장은 그 기록의 자리로", () => {
    const rounds = build({ rows: [row("s1", ["2026-10-01", "2026-10-06"])], marks: [mark("s1", null, "missing", { checkDate: "2026-10-08" })] });
    expect(view(rounds)).toEqual([["2026-10-01", "unchecked", null, false], ["2026-10-06", "missing", null, false]]);
    expect(roundWriteKey(rounds.get("A:s1")![1])).toBe("c:2026-10-08");
    expect(roundWriteKey(rounds.get("A:s1")![0])).toBe("h:2026-10-01");
  });
  it("옛 기록은 직전 숙제 하나에만 — 직전 숙제에 이미 기록이 있거나 14일보다 멀면 검사일 칸에 홀로 선다(더 옛 숙제로 건너뛰지 않음)", () => {
    const taken = build({ rows: [row("s1", ["2026-09-20", "2026-10-06"])], from: "2026-09-01",
      marks: [mark("s1", "2026-10-06", "submitted", { checkDate: "2026-10-07" }), mark("s1", null, "missing", { checkDate: "2026-10-08" })] });
    expect(view(taken)).toEqual([["2026-09-20", "unchecked", null, false], ["2026-10-06", "submitted", null, false], ["2026-10-08", "missing", null, false]]);
    const far = build({ rows: [row("s1", ["2026-09-20"])], from: "2026-09-01", marks: [mark("s1", null, "missing", { checkDate: "2026-10-05" })] });
    expect(view(far)).toEqual([["2026-09-20", "unchecked", null, false], ["2026-10-05", "missing", null, false]]);
  });
  it("검사 대상에서 빠진 줄은 기록만 — 숙제 표시로 새 미확인을 만들지 않고 영상도 세지 않는다", () => {
    const rounds = build({ rows: [row("s1", ["2026-10-06", "2026-10-08"], { tracked: false })],
      marks: [mark("s1", "2026-10-06", "missing")], videos: [video("s1", "2026-10-09")] });
    expect(view(rounds)).toEqual([["2026-10-06", "missing", null, false]]);
  });
  it("조회 기간 밖 회차는 돌려주지 않는다 · 집계는 한 벌", () => {
    const rounds = build({ rows: [row("s1", ["2026-09-28", "2026-10-02", "2026-11-02"])], marks: [mark("s1", "2026-10-02", "missing")] });
    expect(view(rounds)).toEqual([["2026-10-02", "missing", null, false]]);
    expect(roundCounts(rounds.get("A:s1")!)).toEqual({ submitted: 0, missing: 1, unchecked: 0, total: 1 });
  });
});

describe("영상 도착 자동 집계 — 반이 확인된 영상만", () => {
  it("그날까지 나간 미확인 숙제 중 가장 오래된 것에 · 제출일 = 게시일(KST)", () => {
    const rounds = build({ rows: [row("s1", ["2026-10-01", "2026-10-06"])], videos: [video("s1", "2026-10-07", { time: "00:30" })] });
    expect(view(rounds)).toEqual([["2026-10-01", "submitted", "2026-10-07", true], ["2026-10-06", "unchecked", null, false]]);
  });
  it("같은 날 여러 번 올린 영상은 한 번, 다른 날 영상은 각각 다음 숙제에", () => {
    const rounds = build({ rows: [row("s1", ["2026-10-01", "2026-10-06", "2026-10-08"])],
      videos: [video("s1", "2026-10-02"), video("s1", "2026-10-02", { time: "21:00" }), video("s1", "2026-10-07")] });
    expect(view(rounds)).toEqual([
      ["2026-10-01", "submitted", "2026-10-02", true], ["2026-10-06", "submitted", "2026-10-07", true], ["2026-10-08", "unchecked", null, false]]);
  });
  it("숙제보다 먼저 올라온 영상·기한을 넘긴 영상·숙제가 없는 영상은 세지 않는다", () => {
    expect(VIDEO_MATCH_WINDOW_DAYS).toBe(14); // 10/02 숙제 → 10/16 영상까지. 10/17은 짝이 아니다.
    const rounds = build({ rows: [row("s1", ["2026-10-02"]), row("s2", [])],
      videos: [video("s1", "2026-10-01"), video("s1", "2026-10-17", { time: "00:10" }), video("s2", "2026-10-03")], to: "2026-11-30" });
    expect(view(build({ rows: [row("s1", ["2026-10-02"])], videos: [video("s1", "2026-10-16", { time: "23:50" })] })))
      .toEqual([["2026-10-02", "submitted", "2026-10-16", true]]);
    expect(view(rounds)).toEqual([["2026-10-02", "unchecked", null, false]]);
    expect(rounds.get("A:s2")).toEqual([]);
  });
  it("🔴 반을 못 정한 영상·다른 반으로 분류된 영상은 이 줄에 찍지 않는다(같은 과목 반 둘 = 한 영상이 두 줄에 찍히지 않음)", () => {
    const rounds = build({ rows: [row("s1", ["2026-10-01"]), row("s1", ["2026-10-01"], { classId: "JJ" })],
      videos: [video("s1", "2026-10-02", { classId: null }), video("s1", "2026-10-03", { classId: "JJ" })] });
    expect(view(rounds)).toEqual([["2026-10-01", "unchecked", null, false]]);
    expect(view(rounds, "JJ:s1")).toEqual([["2026-10-01", "submitted", "2026-10-03", true]]);
  });
  it("직접 찍은 기록이 이긴다 — 미수행은 그대로, 영상은 다음 미확인 숙제로", () => {
    const rounds = build({ rows: [row("s1", ["2026-10-01", "2026-10-03"])], marks: [mark("s1", "2026-10-01", "missing")],
      videos: [video("s1", "2026-10-04")] });
    expect(view(rounds)).toEqual([["2026-10-01", "missing", null, false], ["2026-10-03", "submitted", "2026-10-04", true]]);
  });
  it("🔴 영상으로 센 칸을 확정해도 그 영상이 다음 숙제를 또 채우지 않는다(두 번 세지 않음)", () => {
    const rows = [row("s1", ["2026-10-01", "2026-10-03"])];
    const videos = [video("s1", "2026-10-04")];
    expect(view(build({ rows, videos }))).toEqual([["2026-10-01", "submitted", "2026-10-04", true], ["2026-10-03", "unchecked", null, false]]);
    const confirmed = build({ rows, videos, marks: [mark("s1", "2026-10-01", "submitted", { submittedDate: "2026-10-04" })] });
    expect(view(confirmed)).toEqual([["2026-10-01", "submitted", "2026-10-04", false], ["2026-10-03", "unchecked", null, false]]);
    expect(confirmed.get("A:s1")![0].videoDate).toBe("2026-10-04");
  });
  it("원스크린 ✓(제출일 없음)은 그 검사 전에 올라온 영상만 가져간다 — 검사 뒤에 올라온 영상은 다음 숙제 몫", () => {
    const rows = [row("s1", ["2026-10-01", "2026-10-06"])];
    const checked = mark("s1", "2026-10-01", "submitted", { checkDate: "2026-10-06", updatedAt: "2026-10-06T08:00:00Z" }); // 17:00 KST
    const before = build({ rows, marks: [checked], videos: [video("s1", "2026-10-06", { time: "10:00" })] });
    expect(view(before)).toEqual([["2026-10-01", "submitted", null, false], ["2026-10-06", "unchecked", null, false]]);
    const after = build({ rows, marks: [checked], videos: [video("s1", "2026-10-06", { time: "21:00" })] });
    expect(view(after)).toEqual([["2026-10-01", "submitted", null, false], ["2026-10-06", "submitted", "2026-10-06", true]]);
  });
  it("조회 기간 앞의 미확인 숙제도 짝 맞추기에는 들어간다 — 기간에 따라 같은 칸 판정이 바뀌지 않게", () => {
    const rows = [row("s1", ["2026-09-29", "2026-10-02"])];
    const videos = [video("s1", "2026-10-03")];
    const october = build({ rows, videos });
    const wide = build({ rows, videos, from: "2026-09-01" });
    expect(view(october)).toEqual([["2026-10-02", "unchecked", null, false]]);
    expect(view(wide)).toEqual([["2026-09-29", "submitted", "2026-10-03", true], ["2026-10-02", "unchecked", null, false]]);
    expect(roundCounts(october.get("A:s1")!)).toEqual({ submitted: 0, missing: 0, unchecked: 1, total: 1 });
  });
  it("🔴 미확인 칸을 한 번 눌러(제출일 = 오늘) 완료로 바꿔도 앞 칸의 영상 완료가 흔들리지 않는다", () => {
    const rows = [row("s1", ["2026-10-01", "2026-10-08"])];
    const videos = [video("s1", "2026-10-09")];
    expect(view(build({ rows, videos }))).toEqual([["2026-10-01", "submitted", "2026-10-09", true], ["2026-10-08", "unchecked", null, false]]);
    const clicked = build({ rows, videos, marks: [mark("s1", "2026-10-08", "submitted", { submittedDate: "2026-10-30" })] });
    expect(view(clicked)).toEqual([["2026-10-01", "submitted", "2026-10-09", true], ["2026-10-08", "submitted", "2026-10-30", false]]);
  });
  it("🔴 최근 60일 안의 어떤 기간을 봐도 같은 칸은 같은 판정 — 서버가 읽는 시작점이 오늘 기준으로 고정", () => {
    // 리뷰 재현: 회차 9/05·9/15·9/24, 영상 9/17·9/25, 기록 없음. 기간 시작에 따라 9/05가 빠지면 영상이 한 칸씩 밀렸다.
    const today = "2026-10-01";
    const assigned = ["2026-09-05", "2026-09-15", "2026-09-24"];
    const videos = [video("s1", "2026-09-17"), video("s1", "2026-09-25")];
    const statusOf924 = (from: string) => {
      const range = videoMatchRange(from, today, today);
      const rounds = build({ rows: [row("s1", assigned.filter((d) => d >= range.from && d <= range.to))],
        videos: videos.filter((v) => v.postedAt.slice(0, 10) >= range.from), from, to: today });
      return rounds.get("A:s1")!.find((r) => r.date === "2026-09-24")!.status;
    };
    expect(videoMatchRange("2026-09-20", today, today)).toEqual(videoMatchRange("2026-09-01", today, today));
    expect(statusOf924("2026-09-20")).toBe(statusOf924("2026-09-01"));
    expect(statusOf924("2026-09-20")).toBe("unchecked");
    // 오래된 기간은 그 기간 앞 2주부터 읽는다.
    expect(videoMatchRange("2026-05-01", "2026-05-31", today)).toEqual({ from: "2026-04-17", to: "2026-06-14" });
  });
  it("짝지어진 영상 id를 칸에 싣는다 — 같은 날 여러 영상이면 가장 먼저 올라온 것, 영상 없는 칸은 null(= 수동 후보)", () => {
    const rows = [row("s1", ["2026-10-01", "2026-10-08", "2026-10-20"])];
    const videos = [video("s1", "2026-10-02", { time: "21:00" }), video("s1", "2026-10-02", { time: "09:00" }), video("s1", "2026-10-09")];
    const rounds = build({ rows, videos, marks: [mark("s1", "2026-10-20", "submitted", { submittedDate: "2026-10-21" })] }).get("A:s1")!;
    expect(rounds.map((r) => r.videoId)).toEqual(["v-s1-2026-10-02-09:00", "v-s1-2026-10-09-20:00", null]);
  });
  it("🔴 직접 찍은 완료라도 그 칸이 볼 수 있던 영상이 짝지어졌으면 영상 쪽(videoId 있음) — 영상 없이 찍은 칸만 videoId null", () => {
    const rounds = build({ rows: [row("s1", ["2026-10-01"])], videos: [video("s1", "2026-10-02")],
      marks: [mark("s1", "2026-10-01", "submitted", { submittedDate: "2026-10-03" })] }).get("A:s1")!;
    expect(rounds[0]).toMatchObject({ status: "submitted", auto: false, videoId: "v-s1-2026-10-02-20:00" });
  });
  it("기록의 자리 = (반 · 학생 · 숙제일) — 어느 화면에서 찍었든 같은 숙제는 같은 자리", () => {
    expect(markIdentity(mark("s1", "2026-10-01", "missing", { checkDate: "2026-10-02" })))
      .toBe(markIdentity(mark("s1", "2026-10-01", "submitted", { checkDate: "2026-10-06" })));
    expect(markIdentity(mark("s1", null, "missing", { checkDate: "2026-10-02" }))).toBe("A:s1:c:2026-10-02");
  });
});

describe("학생이 고른 숙제(올리기 사이트, 원장 2026-10-03) — 그 숙제 칸으로만 간다", () => {
  it("🔴 고른 숙제가 완료된다 — 더 오래된 미확인 숙제가 그 영상을 가져가지 않는다", () => {
    const rows = [row("s1", ["2026-10-01", "2026-10-06"])];
    // 고르지 않은 영상이면 가장 오래된 미확인(10/1)이 가져간다(기존 규칙)
    expect(view(build({ rows, videos: [video("s1", "2026-10-07")] }))).toEqual([
      ["2026-10-01", "submitted", "2026-10-07", true], ["2026-10-06", "unchecked", null, false]]);
    // 10/6 숙제를 골라 올렸으면 10/6 칸만 완료
    const picked = build({ rows, videos: [video("s1", "2026-10-07", { homeworkDate: "2026-10-06" })] });
    expect(view(picked)).toEqual([["2026-10-01", "unchecked", null, false], ["2026-10-06", "submitted", "2026-10-07", true]]);
    expect(picked.get("A:s1")![1]!.videoId).toBe("v-s1-2026-10-07-20:00");
  });
  it("고른 영상을 먼저 붙이고, 남은 영상(ClassNote·옛 링크)이 나머지 칸을 오래된 순으로 채운다 — 한 영상이 두 칸을 채우지 않는다", () => {
    const rounds = build({ rows: [row("s1", ["2026-10-01", "2026-10-06"])], videos: [
      video("s1", "2026-10-07", { homeworkDate: "2026-10-06" }),
      video("s1", "2026-10-08"),
    ] });
    expect(view(rounds)).toEqual([["2026-10-01", "submitted", "2026-10-08", true], ["2026-10-06", "submitted", "2026-10-07", true]]);
  });
  it("🔴 같은 날 고른 영상과 안 고른 영상이 함께 와도 한 번이다 — 같은 영상을 사이트와 ClassNote에 함께 올려도 두 칸을 채우지 않는다", () => {
    const rounds = build({ rows: [row("s1", ["2026-10-01", "2026-10-06"])], videos: [
      video("s1", "2026-10-07", { homeworkDate: "2026-10-06" }),
      video("s1", "2026-10-07", { time: "20:30" }), // 같은 날 ClassNote로도 올라온 영상
    ] });
    expect(view(rounds)).toEqual([["2026-10-01", "unchecked", null, false], ["2026-10-06", "submitted", "2026-10-07", true]]);
    // 다른 날 올라온 안 고른 영상은 종전대로 가장 오래된 미확인 칸으로 · 다른 학생의 같은 날 영상은 무관하다
    const next = build({ rows: [row("s1", ["2026-10-01", "2026-10-06"]), row("s2", ["2026-10-01"])], videos: [
      video("s1", "2026-10-07", { homeworkDate: "2026-10-06" }),
      video("s1", "2026-10-08"),
      video("s2", "2026-10-07"),
    ] });
    expect(view(next)).toEqual([["2026-10-01", "submitted", "2026-10-08", true], ["2026-10-06", "submitted", "2026-10-07", true]]);
    expect(view(next, "A:s2")).toEqual([["2026-10-01", "submitted", "2026-10-07", true]]);
    // 고른 영상이 칸에 못 붙었으면(없는 숙제) 그날의 안 고른 영상은 종전대로 센다
    const stray = build({ rows: [row("s1", ["2026-10-01"])], videos: [
      video("s1", "2026-10-07", { homeworkDate: "2026-10-05" }),
      video("s1", "2026-10-07", { time: "20:30" }),
    ] });
    expect(view(stray)).toEqual([["2026-10-01", "submitted", "2026-10-07", true]]);
  });
  it("같은 숙제에 영상을 여러 번 올려도 한 번이고(먼저 올린 것), 남는 영상이 다른 칸으로 넘어가지 않는다", () => {
    const rounds = build({ rows: [row("s1", ["2026-10-01", "2026-10-06"])], videos: [
      video("s1", "2026-10-08", { homeworkDate: "2026-10-06", time: "21:00" }),
      video("s1", "2026-10-07", { homeworkDate: "2026-10-06" }),
    ] });
    expect(view(rounds)).toEqual([["2026-10-01", "unchecked", null, false], ["2026-10-06", "submitted", "2026-10-07", true]]);
  });
  it("🔴 직접 찍은 기록이 이긴다 — 미수행(✕) 칸은 그대로 · 직접 찍은 완료 칸에는 영상이 붙는다(표시는 그대로)", () => {
    const missing = build({ rows: [row("s1", ["2026-10-06"])], marks: [mark("s1", "2026-10-06", "missing")],
      videos: [video("s1", "2026-10-07", { homeworkDate: "2026-10-06" })] });
    expect(view(missing)).toEqual([["2026-10-06", "missing", null, false]]);
    expect(missing.get("A:s1")![0]!.videoId).toBeNull();
    const done = build({ rows: [row("s1", ["2026-10-06"])], marks: [mark("s1", "2026-10-06", "submitted", { submittedDate: "2026-10-06" })],
      videos: [video("s1", "2026-10-09", { homeworkDate: "2026-10-06" })] });
    expect(view(done)).toEqual([["2026-10-06", "submitted", "2026-10-06", false]]);
    expect(done.get("A:s1")![0]!.videoId).toBe("v-s1-2026-10-09-20:00");
  });
  it("없는 숙제·다른 반·숙제보다 먼저·2주를 넘긴 영상은 어느 칸에도 붙지 않는다(게시일순 규칙으로 되돌아가지도 않는다)", () => {
    const rows = [row("s1", ["2026-10-06"])];
    for (const v of [
      video("s1", "2026-10-07", { homeworkDate: "2026-10-05" }), // 숙제가 나가지 않은 날
      video("s1", "2026-10-07", { homeworkDate: "2026-10-06", classId: "B" }), // 다른 반으로 분류된 영상
      video("s1", "2026-10-05", { homeworkDate: "2026-10-06" }), // 숙제보다 먼저
      video("s1", "2026-10-21", { homeworkDate: "2026-10-06" }), // 2주 넘김
    ]) expect(view(build({ rows, videos: [v] })), v.id).toEqual([["2026-10-06", "unchecked", null, false]]);
    // 영상 숙제 대상이 아닌 반(tracked 아님)은 영상으로 칸을 만들지 않는다
    expect(view(build({ rows: [row("s1", ["2026-10-06"], { tracked: false })], videos: [video("s1", "2026-10-07", { homeworkDate: "2026-10-06" })] }))).toEqual([]);
  });
});
