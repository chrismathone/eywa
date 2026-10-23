import { describe, expect, it } from "vitest";
import { fillablePairs, idleLessonDates, pendingVideoPairs, splitIdlePairs } from "./idle-rows";
import { buildLedgerRounds } from "./rounds";
import type { VideoArrival } from "./types";

// 이희재 건(원장 2026-10-22) 모양 — 10월에 반 전체가 영상 숙제 0건인 반(BS3G)에 숙제 없이 올린 영상 하나.
const video = (id: string, day: string, extra: Partial<VideoArrival> = {}): VideoArrival => ({
  id, studentId: "lee", classId: "bs3g", postedAt: `${day}T17:06:00+09:00`, free: true,
  playback: { preview: "p", thumbnail: "t", uploadedAt: `${day}T17:10:00+09:00` }, ...extra,
});
const idle = [{ classId: "bs3g", studentId: "lee" }, { classId: "bs3g", studentId: "friend" }, { classId: "jj3i", studentId: "lee" }];
const pending = (videos: VideoArrival[], rows: { classId: string; studentId: string; assignedDates: string[]; kept?: string[] }[] = [], freeOnly = false) =>
  pendingVideoPairs({ videos, fromDate: "2026-10-01", toDate: "2026-10-22", freeOnly,
    rounds: buildLedgerRounds({ rows: rows.map((row) => ({ ...row, tracked: true })), marks: [], videos, fromDate: "2026-09-01", toDate: "2026-11-05" }) });
const split = (videos: VideoArrival[], rows: { classId: string; studentId: string; assignedDates: string[]; kept?: string[] }[] = []) =>
  splitIdlePairs(idle, pending(videos, rows));

describe("숙제 0건 반 — 줄(①)과 검색 명단(②)", () => {
  it("기간 안에 그 반으로 올라온 붙지 않은 영상이 있는 학생만 줄로 선다 — 반 친구 · 다른 반은 검색 명단", () => {
    const result = split([video("free", "2026-10-22")]);
    expect(result.free).toEqual([{ classId: "bs3g", studentId: "lee" }]);
    expect(result.rest).toEqual([{ classId: "bs3g", studentId: "friend" }, { classId: "jj3i", studentId: "lee" }]);
  });
  it("숙제 없이 올린 영상이 아니어도(ClassNote) 칸에 안 붙었으면 같다 — 미배정 알림과 같은 판정", () => {
    expect(split([video("cn", "2026-10-20", { free: false })]).free).toHaveLength(1);
  });
  it("손 배정 · 기간 밖 · 반 미정 · 업로드 전 영상은 줄을 세우지 않는다", () => {
    for (const candidate of [video("m", "2026-10-20", { manuallyAssigned: true, homeworkDate: "2026-10-19" }), video("old", "2026-09-30"),
      video("none", "2026-10-20", { classId: null }), video("queued", "2026-10-20", { playback: null })]) {
      expect(split([candidate]).free, candidate.id).toEqual([]);
    }
  });
  it("회차가 있는 반의 줄에는 숙제 없이 올린 영상만 센다(ClassNote 영상은 종전 버튼 판정 — 10-13·10-14)", () => {
    expect([...pending([video("free", "2026-10-20")], [], true)]).toEqual(["bs3g:lee"]);
    expect([...pending([video("cn", "2026-10-20", { free: false })], [], true)]).toEqual([]);
  });
  it("기간 밖 앞선 숙제(넓혀 읽은 회차)가 이미 받은 영상은 미배정이 아니다", () => {
    const cn = video("cn", "2026-10-02", { free: false });
    expect(split([cn], [{ classId: "bs3g", studentId: "lee", assignedDates: ["2026-09-28"] }]).free).toEqual([]);
  });
});

describe("숙제 0건 반 줄의 숙제없음 칸 = 그 학생이 들은 수업일", () => {
  const schedules = [{ class_id: "bs3g", day_of_week: "mon", valid_from: "2026-03-01", valid_to: null }, { class_id: "bs3g", day_of_week: "thu", valid_from: "2026-03-01", valid_to: null }];
  const enrollments = [{ class_id: "bs3g", student_id: "lee", start_date: "2026-03-01", end_date: null, on_hold: false, is_transferred: false, attendance_days: null }];
  const att = (session_date: string, status: string) => ({ id: session_date, student_id: "lee", class_id: "bs3g", session_date, slot_start: null, status, recorded_at: `${session_date}T09:00:00Z` });
  it("결석일 · 휴원일은 빠지고 사유는 전부 '숙제없음'", () => {
    const result = idleLessonDates({ pairs: [{ classId: "bs3g", studentId: "lee" }], schedules, enrollments, fromDate: "2026-10-12", toDate: "2026-10-22",
      // 10/12(월) 결석 · 10/15(목) 출결 없는 휴원일 · 다른 반 출결은 이 줄과 무관
      records: [att("2026-10-12", "absent"), att("2026-10-19", "present"), att("2026-10-22", "present"),
        { ...att("2026-10-15", "present"), class_id: "other" }],
      isHoliday: (date) => date === "2026-10-15" });
    expect(result.dates.get("bs3g:lee")).toEqual(["2026-10-19", "2026-10-22"]);
    expect(result.facts).toEqual({ "bs3g:lee": { "2026-10-19": "none", "2026-10-22": "none" } });
  });
  it("종강 뒤 날은 출결이 없으면 수업일이 아니다(명단의 종강 판정과 같다)", () => {
    const result = idleLessonDates({ pairs: [{ classId: "bs3g", studentId: "lee" }], schedules, enrollments, records: [att("2026-10-19", "present")],
      fromDate: "2026-10-12", toDate: "2026-10-22", isHoliday: () => false, closedOn: () => "2026-10-15T09:00:00+00:00" });
    expect(result.dates.get("bs3g:lee")).toEqual(["2026-10-12", "2026-10-15", "2026-10-19"]);
  });
  it("수업일이 없으면 칸도 사유도 없다(줄은 선다 — 집계 제외나 다른 반 숙제로 옮길 수 있다)", () => {
    const result = idleLessonDates({ pairs: [{ classId: "bs3g", studentId: "lee" }], schedules, enrollments: [], records: [], fromDate: "2026-10-12", toDate: "2026-10-22", isHoliday: () => false });
    expect(result.dates.get("bs3g:lee")).toEqual([]);
    expect(result.facts).toEqual({});
  });
});

// 원장 2026-10-23 *"숙제가 없는데도 미배정 영상이 남아있으면 그건 알림 오류"* — 장부 '영상 배정 필요함'도 미배정 알림과 같은 판정.
describe("'영상 배정 필요함' = 붙일 빈 숙제가 있는 미배정 영상의 그 칸 줄", () => {
  const rounds = (rows: { classId: string; studentId: string; assignedDates: string[] }[], videos: VideoArrival[]) =>
    buildLedgerRounds({ rows: rows.map((row) => ({ ...row, tracked: true })), marks: [], videos, fromDate: "2026-09-01", toDate: "2026-11-05" });
  const at = (rows: { classId: string; studentId: string; assignedDates: string[] }[], videos: VideoArrival[]) =>
    fillablePairs({ videos, rounds: rounds(rows, videos), fromDate: "2026-10-01", toDate: "2026-10-22" });
  it("숙제 0건 반 · 숙제가 다 영상으로 찬 줄의 남은 영상은 걸리지 않는다", () => {
    expect(at([], [video("free", "2026-10-20")])).toEqual(new Set());
    const filled = [video("a", "2026-10-14", { free: false, homeworkDate: "2026-10-13" }), video("free", "2026-10-15")];
    expect(at([{ classId: "bs3g", studentId: "lee", assignedDates: ["2026-10-13"] }], filled)).toEqual(new Set());
  });
  it("영상이 안 붙은 숙제가 있으면 그 숙제의 줄이 걸린다 — 반을 모르는 영상도", () => {
    const rows = [{ classId: "bs3g", studentId: "lee", assignedDates: ["2026-10-13"] }];
    expect(at(rows, [video("free", "2026-10-15")])).toEqual(new Set(["bs3g:lee"]));
    expect(at(rows, [video("cn", "2026-10-15", { free: false, classId: null })])).toEqual(new Set(["bs3g:lee"]));
  });
});
