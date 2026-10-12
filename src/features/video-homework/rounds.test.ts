import { describe, expect, it } from "vitest";
import { buildLedgerRounds, markIdentity, roundCounts, roundWriteKey, VIDEO_MATCH_WINDOW_DAYS, videoArrivedAt, videoFingerprint, videoMatchRange } from "./rounds";
import type { VideoArrival, VideoHomeworkMark } from "./types";

const row = (studentId: string, assignedDates: string[], extra: { classId?: string; tracked?: boolean } = {}) =>
  ({ classId: extra.classId ?? "A", studentId, assignedDates, tracked: extra.tracked ?? true });
const mark = (studentId: string, homeworkDate: string | null, status: VideoHomeworkMark["status"], extra: Partial<VideoHomeworkMark> = {}): VideoHomeworkMark =>
  ({ classId: "A", studentId, checkDate: homeworkDate ? "2026-10-20" : "2026-10-05", homeworkDate, status, ...extra });
// 원스크린 체크는 실제 검사 시각이 남는다 — 기본은 한참 뒤(영상 게시 이후)라 '그 검사가 본 영상' 판정이 켜지지 않는다.
const kst = (day: string, time = "20:00") => `${day}T${time}:00+09:00`;
const video = (studentId: string, day: string, extra: { classId?: string | null; time?: string; homeworkDate?: string; arrivedAt?: string; fingerprint?: string } = {}): VideoArrival =>
  ({ id: `v-${studentId}-${day}-${extra.time ?? "20:00"}`, studentId, classId: extra.classId === undefined ? "A" : extra.classId, postedAt: kst(day, extra.time),
    ...(extra.homeworkDate ? { homeworkDate: extra.homeworkDate } : {}), ...(extra.arrivedAt ? { arrivedAt: extra.arrivedAt } : {}),
    ...(extra.fingerprint ? { fingerprint: extra.fingerprint } : {}) });
const build = (input: { rows: ReturnType<typeof row>[]; marks?: VideoHomeworkMark[]; videos?: VideoArrival[]; from?: string; to?: string }) =>
  buildLedgerRounds({ rows: input.rows, marks: input.marks ?? [], videos: input.videos ?? [], fromDate: input.from ?? "2026-10-01", toDate: input.to ?? "2026-10-31" });
const view = (rounds: ReturnType<typeof build>, pair = "A:s1") =>
  (rounds.get(pair) ?? []).map((r) => [r.date, r.status, r.submittedDate, r.auto]);

describe("영어·수학 구분과 담당자의 수동 배정", () => {
  it("같은 학생의 영어 영상으로 수학 숙제를 완료시키지 않는다", () => {
    const rows = [row("s1", ["2026-10-01"]), row("s1", ["2026-10-01"], { classId: "english" })];
    const rounds = build({ rows, videos: [video("s1", "2026-10-02", { classId: "english", homeworkDate: "2026-10-01" })] });
    expect(view(rounds)[0]?.[1]).toBe("unchecked"); expect(view(rounds, "english:s1")[0]?.[1]).toBe("submitted");
  });
  it("수동으로 정한 숙제는 14일 추정 범위를 넘어도 그 칸에만 붙는다", () => {
    const v = { ...video("s1", "2026-10-25", { homeworkDate: "2026-10-01" }), manuallyAssigned: true };
    const rows = [row("s1", ["2026-10-01", "2026-10-20"])];
    expect(view(build({ rows, videos: [v] })).map(r => r[1])).toEqual(["submitted", "unchecked"]);
    expect(view(build({ rows, videos: [{ ...v, manuallyAssigned: false }] })).map(r => r[1])).toEqual(["unchecked", "unchecked"]);
  });
  it("집계 제외(classId 없음) 영상은 다른 날짜로 자동 재배정되지 않는다", () => {
    expect(view(build({ rows: [row("s1", ["2026-10-01"])], videos: [video("s1", "2026-10-02", { classId: null })] }))[0]?.[1]).toBe("unchecked");
  });
});

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
  it("미수행 체크 뒤 올린 영상도 그 숙제에 붙인다 — 다음 숙제로 밀리지 않는다", () => {
    const rounds = build({ rows: [row("s1", ["2026-10-01", "2026-10-03"])], marks: [mark("s1", "2026-10-01", "missing")],
      videos: [video("s1", "2026-10-04")] });
    expect(view(rounds)).toEqual([["2026-10-01", "missing", null, false], ["2026-10-03", "unchecked", null, false]]);
    expect(rounds.get("A:s1")![0].videoId).toBe("v-s1-2026-10-04-20:00");
  });
  it("🔴 영상으로 센 칸을 확정해도 그 영상이 다음 숙제를 또 채우지 않는다(두 번 세지 않음)", () => {
    const rows = [row("s1", ["2026-10-01", "2026-10-03"])];
    const videos = [video("s1", "2026-10-04")];
    expect(view(build({ rows, videos }))).toEqual([["2026-10-01", "submitted", "2026-10-04", true], ["2026-10-03", "unchecked", null, false]]);
    const confirmed = build({ rows, videos, marks: [mark("s1", "2026-10-01", "submitted", { submittedDate: "2026-10-04" })] });
    expect(view(confirmed)).toEqual([["2026-10-01", "submitted", "2026-10-04", false], ["2026-10-03", "unchecked", null, false]]);
    expect(confirmed.get("A:s1")![0].videoDate).toBe("2026-10-04");
  });
  it("수동 ✓ 전후 어느 때 올려도 동일한 숙제에 연결한다", () => {
    const rows = [row("s1", ["2026-10-01", "2026-10-06"])];
    const checked = mark("s1", "2026-10-01", "submitted", { checkDate: "2026-10-06", updatedAt: "2026-10-06T08:00:00Z" }); // 17:00 KST
    const before = build({ rows, marks: [checked], videos: [video("s1", "2026-10-06", { time: "10:00" })] });
    expect(view(before)).toEqual([["2026-10-01", "submitted", null, false], ["2026-10-06", "unchecked", null, false]]);
    const after = build({ rows, marks: [checked], videos: [video("s1", "2026-10-06", { time: "21:00" })] });
    expect(view(after)).toEqual([["2026-10-01", "submitted", null, false], ["2026-10-06", "unchecked", null, false]]);
    expect(after.get("A:s1")![0].videoId).toBe("v-s1-2026-10-06-21:00");
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
  it("🔴 나중에 올린 영상이 이미 완료(영상)로 보이던 칸을 미확인으로 되돌리지 않는다 — 오전 ClassNote 영상 + 오후 사이트에서 다른 숙제", () => {
    const rows = [row("s1", ["2026-10-01", "2026-10-06"])];
    const morning = video("s1", "2026-10-07", { time: "09:00" }); // ClassNote로 올린 영상 → 가장 오래된 미확인(10/1)
    expect(view(build({ rows, videos: [morning] }))).toEqual([["2026-10-01", "submitted", "2026-10-07", true], ["2026-10-06", "unchecked", null, false]]);
    // 같은 날 오후 사이트에서 10/6 숙제를 골라 올렸다 — 10/1은 완료 그대로, 10/6도 완료
    const both = build({ rows, videos: [morning, video("s1", "2026-10-07", { time: "15:00", homeworkDate: "2026-10-06" })] });
    expect(view(both)).toEqual([["2026-10-01", "submitted", "2026-10-07", true], ["2026-10-06", "submitted", "2026-10-07", true]]);
    expect(both.get("A:s1")!.map((r) => r.videoId)).toEqual([morning.id, "v-s1-2026-10-07-15:00"]);
    // 고른 영상과 같은 시각이거나 그 뒤에 온 안 고른 영상만 겹쳐 올린 것으로 본다(세지 않는다)
    const same = build({ rows, videos: [video("s1", "2026-10-07", { time: "15:00" }), video("s1", "2026-10-07", { time: "15:00", homeworkDate: "2026-10-06" })] });
    expect(view(same)).toEqual([["2026-10-01", "unchecked", null, false], ["2026-10-06", "submitted", "2026-10-07", true]]);
    // 오전·오후 두 번 안 고른 영상이 와도 하루 한 번 — 오전 것만 센다
    const three = build({ rows: [row("s1", ["2026-10-01", "2026-10-02", "2026-10-06"])], videos: [
      morning, video("s1", "2026-10-07", { time: "15:00", homeworkDate: "2026-10-06" }), video("s1", "2026-10-07", { time: "21:00" }) ] });
    expect(view(three)).toEqual([["2026-10-01", "submitted", "2026-10-07", true], ["2026-10-02", "unchecked", null, false], ["2026-10-06", "submitted", "2026-10-07", true]]);
  });
  it("🔴 같은 날 고른 영상이 둘이면 먼저 들어온 것이 기준이다 · 칸에 못 붙은 고른 영상은 기준을 만들지 않는다", () => {
    const rows = [row("s1", ["2026-10-01", "2026-10-06", "2026-10-08"])];
    const videos = [
      video("s1", "2026-10-09", { time: "10:00", homeworkDate: "2026-10-06" }),
      video("s1", "2026-10-09", { time: "12:00" }),
      video("s1", "2026-10-09", { time: "16:00", homeworkDate: "2026-10-08" }),
    ];
    // 12:00 영상은 10:00에 들어온 고른 영상보다 늦다 → 세지 않는다(16:00을 기준으로 삼으면 10/1이 완료로 뒤집힌다)
    expect(view(build({ rows, videos }))).toEqual([["2026-10-01", "unchecked", null, false], ["2026-10-06", "submitted", "2026-10-09", true], ["2026-10-08", "submitted", "2026-10-09", true]]);
    // 수동 ✕가 있어도 정확한 숙제에 연결하고, 같은 날 중복된 영상이 다른 숙제를 채우지 않는다.
    const blocked = build({ rows, marks: [mark("s1", "2026-10-06", "missing")], videos });
    expect(view(blocked).map((r) => r.slice(0, 2))).toEqual([["2026-10-01", "unchecked"], ["2026-10-06", "missing"], ["2026-10-08", "submitted"]]);
  });
  it("🔴 같은 파일(지문이 같다)이면 순서·날짜와 상관없이 한 번이다 — 먼저 ClassNote로 올라와 다른 칸을 채웠던 같은 파일은 그 칸에서 빠진다", () => {
    const rows = [row("s1", ["2026-10-01", "2026-10-06"])];
    const F = "0123456789abcdef:34795724";
    // 오전 ClassNote(10/1을 채웠다) → 오후 같은 파일을 사이트에서 10/6으로 골라 올렸다 → 10/1은 정말로 아직 안 낸 숙제
    const same = build({ rows, videos: [
      video("s1", "2026-10-07", { time: "09:00", fingerprint: F }),
      video("s1", "2026-10-07", { time: "15:00", homeworkDate: "2026-10-06", fingerprint: F }),
    ] });
    expect(view(same)).toEqual([["2026-10-01", "unchecked", null, false], ["2026-10-06", "submitted", "2026-10-07", true]]);
    // 숙제일 이후 다른 날 올라온 같은 파일도 다시 세지 않는다 · 다른 반으로 분류된 같은 파일은 무관하다(반 × 학생 단위 — 화면마다 판정이 갈리지 않게)
    const otherDay = build({ rows: [row("s1", ["2026-10-01", "2026-10-06"]), row("s1", ["2026-10-02"], { classId: "B" })], videos: [
      video("s1", "2026-10-06", { time: "21:00", fingerprint: F }),
      video("s1", "2026-10-08", { time: "15:00", homeworkDate: "2026-10-06", fingerprint: F }),
      video("s1", "2026-10-07", { classId: "B", fingerprint: F }), // 숙제일(10/6) 뒤 — 학생 단위로 묶으면 여기서 빠진다
    ] });
    expect(view(otherDay)).toEqual([["2026-10-01", "unchecked", null, false], ["2026-10-06", "submitted", "2026-10-08", true]]);
    expect(view(otherDay, "B:s1")).toEqual([["2026-10-02", "submitted", "2026-10-07", true]]);
    // 🔴 그 숙제가 나가기 **전에** 이미 올라와 있던 사본은 그 숙제의 영상일 수 없다(옛 영상을 다시 고른 것) — 낸 칸(10/1)을 지우지 않는다
    const reused = build({ rows, videos: [
      video("s1", "2026-10-02", { fingerprint: F }),
      video("s1", "2026-10-07", { time: "15:00", homeworkDate: "2026-10-06", fingerprint: F }),
    ] });
    expect(view(reused)).toEqual([["2026-10-01", "submitted", "2026-10-02", true], ["2026-10-06", "submitted", "2026-10-07", true]]);
    // 같은 파일을 두 숙제에 골라 올리면 가장 이른 숙제일이 기준이다(고른 영상은 학생이 고른 칸에 그대로 붙는다)
    const twice = build({ rows: [row("s1", ["2026-10-01", "2026-10-03", "2026-10-06"])], videos: [
      video("s1", "2026-10-04", { time: "09:00", fingerprint: F }),
      video("s1", "2026-10-07", { time: "15:00", homeworkDate: "2026-10-06", fingerprint: F }),
      video("s1", "2026-10-07", { time: "16:00", homeworkDate: "2026-10-03", fingerprint: F }),
    ] });
    expect(view(twice).map((r) => r.slice(0, 2))).toEqual([["2026-10-01", "unchecked"], ["2026-10-03", "submitted"], ["2026-10-06", "submitted"]]);
    // 파일이 다르거나(다시 압축된 사본 포함) 지문이 없으면 종전 시각 규칙 — 먼저 들어온 영상은 그대로 센다
    for (const fingerprint of ["fedcba9876543210:34795724", undefined]) {
      const other = build({ rows, videos: [
        video("s1", "2026-10-07", { time: "09:00", ...(fingerprint ? { fingerprint } : {}) }),
        video("s1", "2026-10-07", { time: "15:00", homeworkDate: "2026-10-06", fingerprint: F }),
      ] });
      expect(view(other)).toEqual([["2026-10-01", "submitted", "2026-10-07", true], ["2026-10-06", "submitted", "2026-10-07", true]]);
    }
    // 수동 ✕가 있어도 고른 숙제에 붙인다. 같은 파일의 사본으로 다른 숙제를 완료시키지 않는다.
    const blocked = build({ rows, marks: [mark("s1", "2026-10-06", "missing")], videos: [
      video("s1", "2026-10-07", { time: "09:00", fingerprint: F }),
      video("s1", "2026-10-07", { time: "15:00", homeworkDate: "2026-10-06", fingerprint: F }),
    ] });
    expect(view(blocked).map((r) => r.slice(0, 2))).toEqual([["2026-10-01", "unchecked"], ["2026-10-06", "missing"]]);
    // 다른 학생의 같은 지문은 무관하다
    const twoKids = build({ rows: [row("s1", ["2026-10-06"]), row("s2", ["2026-10-01"])], videos: [
      video("s1", "2026-10-07", { time: "15:00", homeworkDate: "2026-10-06", fingerprint: F }),
      video("s2", "2026-10-07", { time: "09:00", fingerprint: F }),
    ] });
    expect(view(twoKids, "A:s2")).toEqual([["2026-10-01", "submitted", "2026-10-07", true]]);
  });
  it("지문 = md5 앞 16자 + 용량 · 모양이 틀리면 판정하지 않는다", () => {
    expect(videoFingerprint("0123456789ABCDEF0123456789abcdef", 34795724)).toBe("0123456789abcdef:34795724");
    expect(videoFingerprint(" 0123456789abcdef0123456789abcdef ", "34795724")).toBe("0123456789abcdef:34795724");
    for (const [md5, bytes] of [[null, 1], ["0123", 1], ["0123456789abcdef0123456789abcdeg", 1], ["0123456789abcdef0123456789abcdef", 0],
      ["0123456789abcdef0123456789abcdef", null], ["0123456789abcdef0123456789abcdef", "12a"], ["0123456789abcdef0123456789abcdef", 1.5]] as const)
      expect(videoFingerprint(md5, bytes)).toBeNull();
  });
  it("🔴 기준은 게시 순서의 첫 영상이 아니라 가장 먼저 **들어온** 고른 영상이다", () => {
    const rows = [row("s1", ["2026-10-01", "2026-10-06", "2026-10-08"])];
    const rounds = build({ rows, videos: [
      video("s1", "2026-10-09", { time: "10:00", homeworkDate: "2026-10-06", arrivedAt: kst("2026-10-09", "17:00") }), // 10:00에 시작해 17:00에야 마무리
      video("s1", "2026-10-09", { time: "16:00", homeworkDate: "2026-10-08", arrivedAt: kst("2026-10-09", "16:02") }),
      video("s1", "2026-10-09", { time: "16:30", arrivedAt: kst("2026-10-09", "16:31") }),
    ] });
    // 기준 16:02 → 16:31에 들어온 안 고른 영상은 세지 않는다(게시 순 첫 영상의 17:00을 기준으로 삼으면 10/1이 완료로 뒤집힌다)
    expect(view(rounds).map((r) => r.slice(0, 2))).toEqual([["2026-10-01", "unchecked"], ["2026-10-06", "submitted"], ["2026-10-08", "submitted"]]);
  });
  it("들어온 시각 — 고른 영상은 줄이 생긴 시각 · 안 고른 영상은 줄이 생긴 시각과 실제 시각(ClassNote 게시 · Drive 파일 생성) 중 이른 쪽", () => {
    const at = (time: string) => new Date(kst("2026-10-07", time)).toISOString();
    // 🔴 ClassNote 영상은 늦게 수집돼도(연동 PC 꺼짐·10분 주기) 학부모가 올린 시각이 기준이다
    expect(videoArrivedAt({ createdAt: kst("2026-10-07", "15:01"), postedAt: kst("2026-10-07", "14:52"), uploadedAt: kst("2026-10-07", "15:05"), fromClassnote: true, picked: false })).toBe(at("14:52"));
    // 직접 넣은 Drive 파일은 게시 시각(정오 고정)이 아니라 Drive 파일 생성 시각 — 휴지통에서 되살려 줄이 다시 생겨도 같다
    expect(videoArrivedAt({ createdAt: kst("2026-10-07", "11:10"), postedAt: kst("2026-10-07", "12:00"), uploadedAt: kst("2026-10-07", "09:00"), fromClassnote: false, picked: false })).toBe(at("09:00"));
    // 실제 시각이 줄보다 늦게 적혀 있어도 줄이 생긴 시각을 넘지 않는다(먼저 보이던 영상은 늘 이르다)
    expect(videoArrivedAt({ createdAt: kst("2026-10-07", "09:05"), postedAt: kst("2026-10-07", "12:00"), uploadedAt: kst("2026-10-07", "09:30"), fromClassnote: false, picked: false })).toBe(at("09:05"));
    // 고른 영상(사이트)은 올리기를 시작한 시각이 아니라 줄이 생긴 시각
    expect(videoArrivedAt({ createdAt: kst("2026-10-08", "08:00"), postedAt: kst("2026-10-07", "15:00"), uploadedAt: kst("2026-10-07", "23:00"), fromClassnote: false, picked: true })).toBe(new Date(kst("2026-10-08", "08:00")).toISOString());
    // 🔴 보고서 글에 댓글로 올려 숙제가 정해진 ClassNote 영상 — 사이트 업로드가 아니다. 늦게 수집돼도 학부모가 올린 시각이 기준이다
    expect(videoArrivedAt({ createdAt: kst("2026-10-07", "15:01"), postedAt: kst("2026-10-07", "14:52"), uploadedAt: kst("2026-10-07", "15:05"), fromClassnote: true, picked: true })).toBe(at("14:52"));
    // 읽을 수 있는 시각이 없으면 null(게시 시각으로 본다)
    expect(videoArrivedAt({ createdAt: null, uploadedAt: "모름", fromClassnote: false, picked: false })).toBeNull();
  });
  /**
   * 원장 2026-10-06: *"해당 숙제 보고서 고유의 링크 주소가 있는 보고서에 영상을 업로드하면 무조건 체킹가능하지."*
   * 연동 PC가 댓글이 달린 글의 보고서를 확인해 영상 줄에 그 숙제일을 싣는다(`scripts/_classnote/video-report-link.mjs`) — 장부는
   * 올리기 사이트에서 숙제를 골라 올린 영상과 같은 길(③)로 붙인다. 여기서는 그 결과가 원장이 말한 대로인지를 잠근다.
   */
  it("🔴 보고서 글에 댓글로 올린 ClassNote 영상은 그 보고서의 숙제 칸으로 간다 — 가장 오래된 미확인 칸을 채우지 않는다", () => {
    const rows = [row("s1", ["2026-10-01", "2026-10-06"])];
    // 10/6 보고서 글에 10/7에 올린 영상 — 10/1은 아직 안 낸 숙제 그대로다(예전 규칙이면 10/1이 완료로 찍혔다)
    const pinned = build({ rows, videos: [video("s1", "2026-10-07", { time: "20:30", homeworkDate: "2026-10-06" })] });
    expect(view(pinned)).toEqual([["2026-10-01", "unchecked", null, false], ["2026-10-06", "submitted", "2026-10-07", true]]);
    // 선생님이 손으로 '완료'를 찍어 둔 칸에 그 영상이 오면 표시는 그대로고(영상이 붙는다), 그 기록을 지워도 완료(영상)로 남는다
    const marked = build({ rows, marks: [mark("s1", "2026-10-06", "submitted", { submittedDate: "2026-10-07" })], videos: [video("s1", "2026-10-07", { homeworkDate: "2026-10-06" })] });
    expect(view(marked)[1]).toEqual(["2026-10-06", "submitted", "2026-10-07", false]);
    // 새 글로 올린 영상(숙제일 없음)은 종전대로 가장 오래된 미확인 칸부터
    const plain = build({ rows, videos: [video("s1", "2026-10-07", { time: "20:30" })] });
    expect(view(plain)).toEqual([["2026-10-01", "submitted", "2026-10-07", true], ["2026-10-06", "unchecked", null, false]]);
  });
  /**
   * 알고 정한 것(리뷰 2026-10-06): 댓글 영상의 들어온 시각 = 학부모가 올린 시각. 수집은 새 글(1분)이 댓글(10분)보다 빨라, 같은 날 **나중에**
   * 올린 새 글 영상이 먼저 장부에 보이다가 댓글 영상이 분류되는 순간 빠진다(그 칸은 미확인으로 돌아간다). 끝난 모습은 "같은 날은 한 번"이다.
   * 들어온 시각을 줄이 생긴 시각으로 되돌리면 이 테스트가 깨진다 — 수집 순서에 따라 두 칸이 채워진다.
   */
  it("🔴 댓글 영상은 학부모가 올린 시각이 기준 — 같은 날 그 뒤에 새 글로 올린 영상은 세지 않고, 먼저 올린 영상은 그대로 센다", () => {
    const rows = [row("s1", ["2026-10-01", "2026-10-06"])];
    const cells = (videos: VideoArrival[]) => view(build({ rows, videos })).map((r) => r.slice(0, 2));
    // 로더가 싣는 값 그대로(ClassNote 줄: 게시 시각 · 연동 PC가 수집해 줄이 생긴 시각)
    const arrive = (posted: string, collected: string, picked: boolean) =>
      videoArrivedAt({ createdAt: kst("2026-10-07", collected), postedAt: kst("2026-10-07", posted), fromClassnote: true, picked })!;
    // 08:55 10/6 보고서 글에 댓글 영상(09:10 수집) · 09:00 새 글 영상(09:01 수집 — 먼저 장부에 보인다)
    const comment = video("s1", "2026-10-07", { time: "08:55", homeworkDate: "2026-10-06", arrivedAt: arrive("08:55", "09:10", true) });
    const later = video("s1", "2026-10-07", { time: "09:00", arrivedAt: arrive("09:00", "09:01", false) });
    expect(cells([later])).toEqual([["2026-10-01", "submitted"], ["2026-10-06", "unchecked"]]); // 댓글 영상 분류 전
    expect(cells([later, comment])).toEqual([["2026-10-01", "unchecked"], ["2026-10-06", "submitted"]]); // 분류 뒤 — 같은 날은 한 번
    // 새 글 영상을 **먼저** 올렸으면(08:50) 늦게 수집됐어도 그대로 센다 — 먼저 올린 영상은 댓글 영상 때문에 빠지지 않는다
    const earlier = video("s1", "2026-10-07", { time: "08:50", arrivedAt: arrive("08:50", "09:20", false) });
    expect(cells([earlier, comment])).toEqual([["2026-10-01", "submitted"], ["2026-10-06", "submitted"]]);
    // 다른 날 올린 새 글 영상은 무관하다
    expect(cells([video("s1", "2026-10-08", { time: "09:00" }), comment])).toEqual([["2026-10-01", "submitted"], ["2026-10-06", "submitted"]]);
  });
  it("🔴 앞뒤는 들어온 시각으로 가른다 — 게시 시각은 순서가 아니다(직접 넣은 Drive 파일은 정오 고정 · 사이트 업로드는 시작 시각)", () => {
    const rows = [row("s1", ["2026-10-01", "2026-10-06"])];
    const done = [["2026-10-01", "submitted", "2026-10-07", true], ["2026-10-06", "submitted", "2026-10-07", true]];
    // (가) 선생님이 09:00에 넣은 Drive 파일(게시 시각은 정오) → 10/1 완료. 10:30 사이트 업로드 뒤에도 10/1은 완료 그대로
    //     (arrivedAt은 로더가 `videoArrivedAt`으로 싣는 값이다)
    const drive = video("s1", "2026-10-07", { time: "12:00", arrivedAt: kst("2026-10-07", "09:05") });
    expect(view(build({ rows, videos: [drive] }))[0]).toEqual(["2026-10-01", "submitted", "2026-10-07", true]);
    expect(view(build({ rows, videos: [drive, video("s1", "2026-10-07", { time: "10:30", homeworkDate: "2026-10-06", arrivedAt: kst("2026-10-07", "10:32") })] }))).toEqual(done);
    // (나) 15:00에 시작한 사이트 업로드가 다음 날에야 마무리됐다 — 그사이 16:00 ClassNote 영상으로 완료된 10/1은 그대로
    const late = video("s1", "2026-10-07", { time: "15:00", homeworkDate: "2026-10-06", arrivedAt: kst("2026-10-08", "08:00") });
    expect(view(build({ rows, videos: [video("s1", "2026-10-07", { time: "16:00", arrivedAt: kst("2026-10-07", "16:03") }), late] }))).toEqual(done);
    // (다) 15:00 사이트 업로드 뒤 18:00에 넣은 같은 날짜 Drive 파일(게시 시각 정오)은 겹쳐 올린 것으로 본다 — 두 칸을 채우지 않는다
    const after = build({ rows, videos: [
      video("s1", "2026-10-07", { time: "15:00", homeworkDate: "2026-10-06", arrivedAt: kst("2026-10-07", "15:02") }),
      video("s1", "2026-10-07", { time: "12:00", arrivedAt: kst("2026-10-07", "18:05") }),
    ] });
    expect(view(after)).toEqual([["2026-10-01", "unchecked", null, false], ["2026-10-06", "submitted", "2026-10-07", true]]);
    // 줄이 생긴 시각을 읽을 수 없으면 게시 시각으로 본다
    const broken = build({ rows, videos: [video("s1", "2026-10-07", { time: "09:00", arrivedAt: "모름" }), video("s1", "2026-10-07", { time: "15:00", homeworkDate: "2026-10-06" })] });
    expect(view(broken)).toEqual(done);
  });
  it("🔴 같은 날 고른 영상 뒤에 안 고른 영상이 와도 한 번이다 — 사이트에 올린 영상을 ClassNote에도 올려도 두 칸을 채우지 않는다", () => {
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
  it("수동 미수행·완료 모두 지정 숙제의 영상을 받는다 — 저장된 상태는 자동 판정 작업이 갱신한다", () => {
    const missing = build({ rows: [row("s1", ["2026-10-06"])], marks: [mark("s1", "2026-10-06", "missing")],
      videos: [video("s1", "2026-10-07", { homeworkDate: "2026-10-06" })] });
    expect(view(missing)).toEqual([["2026-10-06", "missing", null, false]]);
    expect(missing.get("A:s1")![0]!.videoId).toBe("v-s1-2026-10-07-20:00");
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
