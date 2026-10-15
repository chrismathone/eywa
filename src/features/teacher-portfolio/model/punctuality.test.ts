import { describe, expect, it } from "vitest";
import { DEFAULT_PUNCTUALITY_OPTIONS, punctualityOptionsSchema, type PunctualityOptions } from "../evaluation/options";
import { punctualityOf } from "./punctuality";
import { buildPunctualityBasis, type DayBasis, type DayEvidence } from "./punctuality-basis";
import type { SnapshotStaffDay } from "./source-types";
import type { PortfolioSnapshot } from "./types";

/**
 * 강사 근태 — 원장 2026-10-15 *"추천으로 진행. 직원마다 일부 출근시간 퇴근시간 다른 직원이 있음"*.
 * 메이크에듀는 출퇴근 시각만 남긴다 → 그날 기준(첫 수업 시작 · 마지막 수업 끝 · 개인 출퇴근 시각)과 견줘 지각·조퇴·결근을 aywa가 판정한다.
 */
const w = { month: "2026-10", start: "2026-10-01", end: "2026-10-09", partial: false };
const at = (day: string, hm: string) => `${day}T${hm}:00+09:00`;
const rec = (work_date: string, inAt: string | null, outAt: string | null, extra: Partial<SnapshotStaffDay> = {}): SnapshotStaffDay => ({
  user_id: "t1", work_date, status: "present", late_minutes: null, check_in_at: inAt && at(work_date, inAt), check_out_at: outAt && at(work_date, outAt), ...extra,
});
// 10/1(목)~10/9(금) — 평일만 수업(14:00~20:00) · 10/9 휴원 · 10/8 결재된 휴가 · 10/5 태그는 없지만 그날 출결을 넣었다.
const weekday = (day: string) => ![0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay());
const lessons = (day: string): DayBasis | null => (weekday(day) ? { start: "14:00", end: "20:00", basis: "lessons" } : null);
// 증거 — 10/5 수업 중에 넣은 출결(태그 없음) · 10/6 13:58에 넣은 출결.
const evidence = (day: string): DayEvidence =>
  day === "2026-10-05" ? { recorded: true, firstAt: at(day, "15:00") } : day === "2026-10-06" ? { recorded: true, firstAt: at(day, "13:58") } : { recorded: false, firstAt: null };
const run = (days: SnapshotStaffDay[], { manual = null, options = DEFAULT_PUNCTUALITY_OPTIONS, basisOn = lessons, latest = null as string | null }:
  { manual?: number | null; options?: PunctualityOptions; basisOn?: (d: string) => DayBasis | null; latest?: string | null } = {}) =>
  punctualityOf({
    days, leaves: [{ user_id: "t1", start_date: "2026-10-08", end_date: "2026-10-08" }], holidays: new Set(["2026-10-09"]), teacherId: "t1", w, options, manual,
    basisOn, evidenceOn: (day) => evidence(day), latest,
  });

describe("punctualityOf", () => {
  it("출근·퇴근 기록 = 그 달 시각이 찍힌 날 수 · 같은 날 여러 줄은 하루(원장 2026-10-15)", () => {
    const r = run([rec("2026-10-01", "13:50", "20:05"), rec("2026-10-01", "13:55", null), rec("2026-10-02", "13:50", null), rec("2026-10-05", null, "20:10")]);
    expect([r.checkIns, r.checkOuts, r.days]).toEqual([2, 2, 3]);
  });
  const month = [rec("2026-10-01", "13:55", "20:05"), rec("2026-10-02", "14:10", "19:30"), rec("2026-10-07", null, "20:10"),
    rec("2026-10-02", null, null, { user_id: "t2" }), rec("2026-09-30", "15:00", null)];
  it("기준보다 늦게 출근 = 지각 · 일찍 퇴근 = 조퇴 · 기준 있는 날 기록 없음 = 결근 · 퇴근만 찍은 날은 결근 아님", () => {
    const r = run(month);
    // 10/6은 태그가 없지만 수업 중 출결이 있어 '기록으로 출근' — 결근 없음.
    expect([r.raw, r.late, r.absent, r.early, r.days, r.manual]).toEqual([2, 1, 0, 1, 3, false]);
    expect(r.detail.filter((x) => x.counted).map((x) => [x.day, x.status, x.minutes, x.expected])).toEqual([
      ["2026-10-02", "late", 10, "14:00"], ["2026-10-02", "early", 30, "20:00"],
    ]);
    expect(run([rec("2026-10-01", "13:55", "20:05")]).detail.filter((x) => x.counted).map((x) => [x.day, x.status])).toEqual([["2026-10-02", "absent"], ["2026-10-07", "absent"]]);
  });
  it("그날 직접 쓴 출결·보고서가 있으면 출근으로 보고 · 결재된 휴가는 뺀 날 · 휴원일은 판정하지 않는다", () => {
    const r = run(month);
    expect(r.detail.find((x) => x.day === "2026-10-05")).toMatchObject({ status: "recorded", counted: false });
    expect(r.detail.filter((x) => !x.counted && x.status !== "recorded").map((x) => [x.day, x.excuse])).toEqual([["2026-10-08", "결재된 휴가"]]);
    expect(r.detail.some((x) => x.day === "2026-10-09")).toBe(false);
    expect(r.excused).toBe(1);
  });
  it("설정한 분까지는 지각·조퇴로 세지 않는다(기본 5분)", () => {
    const r = run([rec("2026-10-01", "14:05", "19:56"), rec("2026-10-02", "14:06", "19:55")]);
    // 10/1 지각 5분 · 조퇴 4분, 10/2 조퇴 5분 = 세지 않음 · 10/2 지각 6분만 센다.
    expect(r.detail.filter((x) => x.status === "late" || x.status === "early").map((x) => [x.day, x.status, x.minutes])).toEqual([["2026-10-02", "late", 6]]);
    expect(run([rec("2026-10-02", "14:06", null)], { options: { ...DEFAULT_PUNCTUALITY_OPTIONS, graceMinutes: 10 } }).late).toBe(0);
  });
  it("근무 시간대의 가장 이른 본인 출결·보고서가 출근 태그보다 이르면 그때 온 것 — 나갈 때 한 번 찍은 날을 지각으로 재지 않는다", () => {
    expect(run([rec("2026-10-06", "19:00", null)]).detail.filter((x) => x.day === "2026-10-06")).toEqual([]);
    expect(run([rec("2026-10-02", "19:00", null)]).detail.find((x) => x.day === "2026-10-02")).toMatchObject({ status: "late", minutes: 300 });
  });
  it("아직 다 받지 않은 날(메이크에듀 가장 늦은 날짜와 그 뒤)은 결근으로 세지 않는다 · 시각 없이 '출근'이라 적힌 날은 출근", () => {
    const days = [rec("2026-10-01", "13:55", "20:05")];
    expect(run(days, { latest: "2026-10-07" }).detail.filter((x) => x.status === "absent").map((x) => x.day)).toEqual(["2026-10-02"]);
    // 가장 늦은 날은 퇴근 태그가 아직 안 왔을 수 있어 조퇴도 재지 않는다.
    expect(run([rec("2026-10-07", "13:55", "17:00")], { latest: "2026-10-07" }).early).toBe(0);
    expect(run([rec("2026-10-07", "13:55", "17:00")], { latest: "2026-10-08" }).early).toBe(1);
    expect(run([...days, rec("2026-10-02", null, null)]).detail.some((x) => x.day === "2026-10-02")).toBe(false);
  });
  it("가중 — 지각·결근·조퇴 한 번을 몇 회로 셀지", () => {
    const one = [rec("2026-10-01", "13:55", "20:05"), rec("2026-10-02", "14:10", "19:30"), rec("2026-10-06", "13:00", "20:00")];
    expect(run(one, { options: { ...DEFAULT_PUNCTUALITY_OPTIONS, late: 1, absent: 3, early: 0.5 } }).raw).toBe(4.5);
  });
  it("그 달 기록이 하나도 없으면 자료 없음(가져오기 전 달을 결근으로 채우지 않는다) · 원장 입력이 이긴다", () => {
    expect(run([]).raw).toBeNull();
    expect(run([], { manual: 2 })).toMatchObject({ raw: 2, manual: true });
  });
  it("다른 출처가 적어 온 지각·결근·휴가는 그 표시대로 · 날짜가 다른 출근 시각은 지각으로 재지 않는다", () => {
    const r = run([rec("2026-10-01", null, null, { status: "late", late_minutes: 12 }), rec("2026-10-02", "13:00", null, { status: "absent" }),
      rec("2026-10-05", null, null, { status: "leave" }), { ...rec("2026-10-06", "14:00", null), check_in_at: "2026-10-07T05:30:00+09:00" }]);
    expect(r.detail.filter((x) => x.counted).map((x) => [x.day, x.status, x.minutes])).toEqual([["2026-10-01", "late", 12], ["2026-10-02", "absent", null], ["2026-10-07", "absent", null]]);
  });
});

describe("buildPunctualityBasis", () => {
  const classDays = () => [{
    slotTeachers: ["t1", "t2", "t1", null], slotTimes: [{ start: "16:00:00", end: "17:00:00" }, { start: "14:00:00", end: "15:00:00" }, { start: "14:30:00", end: "18:20:00" }, { start: "10:00:00", end: null }],
  }];
  const d = {
    attendance: [
      { recorded_by: "t1", session_date: "2026-10-06", recorded_at: "2026-10-06T05:10:00Z" }, // 14:10 그날 수업 · 그날 입력
      { recorded_by: "t1", session_date: "2026-10-06", recorded_at: "2026-10-06T01:00:00Z" }, // 10:00 집에서 아침에(시간대 밖)
      { recorded_by: "t2", session_date: "2026-10-02", recorded_at: "2026-10-06T05:30:00Z" }, // 지난 출결 고치기(수업일이 다르다)
    ],
    reports: [{ created_by: "t2", report_date: "2026-10-06", created_at: "2026-10-06T06:30:00Z" }], // 15:30 그날 보고서
  } as unknown as PortfolioSnapshot;
  const options = { ...DEFAULT_PUNCTUALITY_OPTIONS, beforeMinutes: 10, hours: [{ userId: "t3", days: ["mon" as const], start: "10:00", end: "18:00" }] };
  const b = buildPunctualityBasis(d, { classDays: classDays as never }, options);
  it("기준 = 그날 맡은 첫 수업 시작 − 설정한 분 · 마지막 수업 끝 · 수업이 없으면 기준 없음", () => {
    expect(b.basisOn("t1", "2026-10-06")).toEqual({ start: "14:20", end: "18:20", basis: "lessons" });
    expect(b.basisOn("t2", "2026-10-06")).toEqual({ start: "13:50", end: "15:00", basis: "lessons" });
    expect(b.basisOn("t9", "2026-10-06")).toBeNull();
  });
  it("개인 출퇴근 시각이 그 요일에 있으면 그 시각(앞당김 없음)", () => {
    expect(b.basisOn("t3", "2026-10-05")).toEqual({ start: "10:00", end: "18:00", basis: "personal" });
    expect(b.basisOn("t3", "2026-10-06")).toBeNull();
  });
  it("증거 = 그날 수업에 대해 그날 근무 시간대에 넣은 본인 출결·보고서뿐(아침 집 입력 · 지난 출결 고치기는 아님)", () => {
    expect(b.evidenceOn("t1", "2026-10-06", b.basisOn("t1", "2026-10-06")!)).toEqual({ recorded: true, firstAt: "2026-10-06T05:10:00Z" });
    expect(b.evidenceOn("t2", "2026-10-06", b.basisOn("t2", "2026-10-06")!)).toEqual({ recorded: true, firstAt: "2026-10-06T06:30:00Z" });
    expect(b.evidenceOn("t2", "2026-10-02", { start: "14:00", end: "20:00", basis: "lessons" })).toEqual({ recorded: false, firstAt: null });
    expect(b.evidenceOn("t1", "2026-10-06", { start: "16:00", end: "20:00", basis: "lessons" })).toEqual({ recorded: false, firstAt: null });
  });
});

it("옛 설정(지각·결근 가중만)도 그대로 읽힌다 — 새 칸은 기본값", () => {
  expect(punctualityOptionsSchema.parse({ late: 1, absent: 2 })).toEqual({ late: 1, absent: 2, early: 1, beforeMinutes: 0, graceMinutes: 5, hours: [] });
});
