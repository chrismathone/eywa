import { describe, expect, it } from "vitest";
import { PORTFOLIO_V1_CONFIG } from "../evaluation/config";
import { buildPortfolio as build } from "./build";
import { awaitsReference } from "./pre-record";
import { metricOf, type MetricId, type PortfolioSnapshot, type SnapshotAttendance, type SnapshotReport, type SnapshotReview } from "./types";

/**
 * 직원 포트폴리오 조립 — 마감(말일 이후 보충은 지난달 점수를 바꾸지 않는다)과 기록 시작 전 달의 처리.
 * 스냅샷: 수학반 하나(수요일 14시), 담임 `teacher`, 학생 `s`. 기준일 2026-10-11(10월은 진행 중).
 */
const fixture = (): PortfolioSnapshot => ({
  tenant: { id: "tenant", name: "검증" }, capturedAt: "2026-10-12T09:00:00Z", from: "2026-04-01", end: "2026-10-11",
  settings: { holidays: [], subjects: [{ key: "math", label: "수학" }], report_subjects: ["math"], report_exempt: [] },
  preRecord: null,
  users: [{ id: "teacher", display_name: "강사", status: "active", subjects: ["math"] }, { id: "proxy", display_name: "대리강사", status: "active", subjects: [] }],
  classes: [{ id: "c", class_name: "반", subject: "math", english_track: null, teacher_id: "teacher", is_active: true, closed_at: null, report_optout: false, is_makeup_pool: false }],
  schedules: [{ id: "s", class_id: "c", day_of_week: "wed", start_time: "14:00", end_time: "14:50", teacher_id: null, slot_teacher_label: null, lab_separate: false, valid_from: "2026-01-01", valid_to: null }],
  enrollments: [{ id: "e", student_id: "s", class_id: "c", start_date: "2026-01-01", end_date: null, on_hold: false, attendance_days: [], is_transferred: false, is_transferred_in: false }],
  attendance: [], reports: [], consultations: [], reviews: [], transitions: [], delegations: [], invoices: [], terms: [], makeupLegacy: [],
});
const report = (day: string, createdAt = `${day}T09:00:00Z`, over: Partial<SnapshotReport> = {}): SnapshotReport => ({
  id: `r${day}`, student_id: "s", class_id: "c", report_date: day, created_by: "teacher", created_at: createdAt, covers_date: null, makeup: false, ...over,
});
const present = (day: string, recordedAt = `${day}T09:00:00Z`, over: Partial<SnapshotAttendance> = {}): SnapshotAttendance => ({
  id: `a${day}`, class_id: "c", student_id: "s", session_date: day, slot_start: "14:00", status: "present", recorded_at: recordedAt,
  supersedes_id: null, seat_label: null, recorded_via: null, taught_by: null, note: null, recorded_by: "teacher", ...over,
});
const stateOn = (d: PortfolioSnapshot, month: string, day: string) => score(d, month, "report").detail.find((c) => c.day === day)?.state;
/** 이 파일은 그 전 직원 포트폴리오의 점수를 지킨다 — 옛 구성으로 매긴다(기본값은 원장 구성, evaluation.test). */
const buildPortfolio = (d: PortfolioSnapshot, opts: Parameters<typeof build>[1] = {}) => build(d, { evaluation: { config: PORTFOLIO_V1_CONFIG }, ...opts });
const months = (d: PortfolioSnapshot) => Object.fromEntries(buildPortfolio(d).teachers.find((t) => t.name === "강사")!.periods.map((w) => [w.month, w]));
const score = <Id extends MetricId>(d: PortfolioSnapshot, month: string, id: Id) => metricOf(months(d)[month], id);
const wednesdays = (month: string) => Array.from({ length: 31 }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)
  .filter((day) => { const at = new Date(`${day}T00:00:00Z`); return at.getUTCMonth() === Number(month.slice(5)) - 1 && at.getUTCDay() === 3; });

describe("8개 항목 100점", () => {
  it("배점 합은 100점이고, 화면 6개월과 전월 비교용 한 달을 낸다", () => {
    const out = buildPortfolio(fixture());
    const periods = out.teachers[0].periods;
    expect(periods.map((w) => w.month)).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04"]);
    expect(out.months).toHaveLength(6);
    const shown = (w: (typeof periods)[number]) => w.items.filter((m) => !m.off);
    expect(periods.every((w) => shown(w).length === 8 && shown(w).reduce((n, m) => n + m.max, 0) === 100)).toBe(true);
    expect([periods[0].partial, periods[0].end, periods[1].partial, periods[1].end]).toEqual([true, "2026-10-11", false, "2026-09-30"]);
  });
  it("본인 보고서는 의무 하나를 채우고, 보고서·교시가 여럿이어도 점수는 불지 않는다", () => {
    const d = fixture();
    d.reports = wednesdays("2026-09").map((day) => report(day));
    d.reports.push(report("2026-09-02", undefined, { id: "dup" }));
    d.schedules.push({ ...d.schedules[0], id: "s2", start_time: "15:00" });
    const m = score(d, "2026-09", "report");
    expect([m.value, m.detail.length]).toEqual([20, 5]);
  });
  it("🔴 본인이 수업 당일(한국 시간)에 쓴 보고서만 작성 — 대리·작성자 모름·다음 날 작성은 전부 미작성(원장 2026-10-14)", () => {
    const d = fixture();
    d.reports = [report("2026-09-02", undefined, { created_by: "proxy" })];
    expect(stateOn(d, "2026-09", "2026-09-02")).toBe("missing");
    d.reports = [report("2026-09-02", undefined, { created_by: null })];
    expect([stateOn(d, "2026-09", "2026-09-02"), score(d, "2026-09", "report").value]).toEqual(["missing", 0]);
    expect(months(d)["2026-09"].total).not.toBeNull();
    d.reports = [report("2026-09-02", "2026-09-02T14:59:59.999Z")];
    expect(stateOn(d, "2026-09", "2026-09-02")).toBe("own");
    d.reports = [report("2026-09-02", "2026-09-02T15:00:00.000Z")];
    expect(stateOn(d, "2026-09", "2026-09-02")).toBe("missing");
  });
  it("다른 반의 보고서·결석한 날·휴원일은 의무를 채우지도 만들지도 않는다", () => {
    const other = fixture();
    other.reports = [report("2026-09-02", undefined, { class_id: "unrelated" })];
    expect(score(other, "2026-09", "report").detail.find((c) => c.day === "2026-09-02")?.state).toBe("missing");
    const absence = fixture();
    absence.attendance = [present("2026-09-02", undefined, { status: "absent" })];
    expect(score(absence, "2026-09", "report").detail.some((c) => c.day === "2026-09-02")).toBe(false);
    const holiday = fixture();
    holiday.settings.holidays = [{ date: "2026-09-02" }];
    expect(score(holiday, "2026-09", "report").detail.some((c) => c.day === "2026-09-02")).toBe(false);
  });
  it("🔴 출결은 본인이 수업 당일에 넣은 것만 작성 — 다른 사람·키오스크·다음 날 입력은 미작성(원장 2026-10-14)", () => {
    const d = fixture();
    d.attendance = wednesdays("2026-09").map((day) => present(day));
    expect(score(d, "2026-09", "attendance").value).toBe(10);
    d.attendance = wednesdays("2026-09").map((day) => present(day, undefined, { recorded_by: "proxy" }));
    expect(score(d, "2026-09", "attendance").value).toBe(0);
    d.attendance = wednesdays("2026-09").map((day) => present(day, undefined, { recorded_by: null }));
    expect(score(d, "2026-09", "attendance").value).toBe(0);
    d.attendance = wednesdays("2026-09").map((day) => present(day, `${day}T15:00:00Z`));
    expect(score(d, "2026-09", "attendance").value).toBe(0);
    // 출결은 고칠 때 같은 행을 덮어쓴다 — 본인이 그날 넣은 뒤 다음 날 다른 사람이 고쳐도, 활동 기록에 그날 본인 입력이 남아 작성이다.
    d.attendance = [present("2026-09-02", "2026-09-05T00:00:00Z", { recorded_by: "proxy" })];
    expect(score(d, "2026-09", "attendance").detail.find((r) => r.day === "2026-09-02")?.done).toBe(false);
    d.attendanceTouches = [{ row_id: "a2026-09-02", actor_id: "teacher", day: "2026-09-02" }, { row_id: "a2026-09-02", actor_id: "proxy", day: "2026-09-05" }];
    expect(score(d, "2026-09", "attendance").detail.find((r) => r.day === "2026-09-02")?.done).toBe(true);
    // 본인 기록이어도 다음 날이면 미작성.
    d.attendanceTouches = [{ row_id: "a2026-09-02", actor_id: "teacher", day: "2026-09-03" }];
    expect(score(d, "2026-09", "attendance").detail.find((r) => r.day === "2026-09-02")?.done).toBe(false);
  });
  it("보고 대상 과목 목록이 비어 있으면 전부 센다 — 조용히 산출불가가 되지 않는다(운영실과 같은 판정)", () => {
    const d = fixture();
    d.settings.report_subjects = [];
    d.reports = wednesdays("2026-09").map((day) => report(day));
    expect(score(d, "2026-09", "report").value).toBe(20);
    d.settings.report_subjects = ["english"];
    expect([score(d, "2026-09", "report").value, score(d, "2026-09", "report").missing]).toEqual([0, true]);
  });
  it("영어는 보고서가 없으면 0점, 직원 평가·과목 소개는 실적이 없으면 0점이다", () => {
    const d = fixture();
    d.classes[0].subject = "english";
    const m = score(d, "2026-09", "report");
    expect([m.value, m.detail.length > 0]).toEqual([0, true]);
    expect([score(d, "2026-09", "quality").value, score(d, "2026-09", "expansion").value]).toEqual([0, 0]);
  });
});

describe("계산 대상 강사", () => {
  it("지금은 수업 담당이 아니어도, 마감 전 달이 남은 강사는 그 달만 계속 계산한다", () => {
    const d = fixture();
    d.users[0].status = "inactive";
    expect(buildPortfolio(d).teachers.map((t) => t.id)).toEqual([]);
    const kept = buildPortfolio(d, { openMonths: new Map([["teacher", ["2026-09"]]]) }).teachers;
    expect(kept.map((t) => [t.id, t.periods.map((w) => w.month)])).toEqual([["teacher", ["2026-09"]]]);
  });
  it("수업에서 빠진 강사는 학생이 없어도 마감 전 달을 놓지 않는다", () => {
    const d = fixture();
    d.users[0].status = "inactive";
    d.enrollments = [];
    expect(buildPortfolio(d, { openMonths: new Map([["teacher", ["2026-10"]]]) }).teachers.map((t) => t.periods.length)).toEqual([1]);
  });
  it("🔴 그 달 전체가 입사 전·퇴사 뒤면 평가 달을 만들지 않는다 — 입사한 달부터(정정 계획만 keepOutsideTenure로 계산)", () => {
    const d = fixture();
    d.users[0].hire_date = "2026-08-17";
    const periods = (o = {}) => buildPortfolio(d, o).teachers.find((t) => t.id === "teacher")!.periods.map((w) => w.month);
    expect(periods()).toEqual(["2026-10", "2026-09", "2026-08"]);
    expect(periods({ keepOutsideTenure: true })).toHaveLength(7);
    d.users[0].hire_date = "2026-01-16";
    d.users[0].resign_date = "2023-02-28"; // 재입사 전 옛 퇴사일은 보지 않는다
    expect(periods()).toHaveLength(7);
  });
});

describe("직원 평가", () => {
  const review = (sheet: SnapshotReview["submissions"][string]): SnapshotReview => ({
    id: "doc", staff_user_id: null, header: { teacherId: "teacher" }, template_name: "평가지",
    areas: [{ key: "a", title: "영역", items: ["문항1", "문항2"] }], submissions: { observer: { byId: "proxy", ...sheet } },
  });
  it("평가는 처음 완료된 달에 한 번만 센다 — 다음 달에 고쳐 저장해도 그 달로 옮겨 가지 않는다", () => {
    const d = fixture();
    d.reviews = [review({ scores: [4, 2], submittedAt: "2026-10-05T01:00:00Z", completedAt: "2026-09-20T01:00:00Z" })];
    expect([score(d, "2026-09", "quality").value, score(d, "2026-10", "quality").value]).toEqual([7.5, 0]);
  });
  it("처음 완료 시각이 없는 옛 장은 제출 시각으로, 미완성 장은 세지 않는다", () => {
    const d = fixture();
    d.reviews = [review({ scores: [4, 4], submittedAt: "2026-09-20T01:00:00Z" })];
    expect(score(d, "2026-09", "quality").value).toBe(10);
    d.reviews = [review({ scores: [4, 0], submittedAt: "2026-09-20T01:00:00Z" })];
    expect(score(d, "2026-09", "quality").value).toBe(0);
  });
});

describe("🔴 말일 마감 — 이후의 보충은 지난달 점수를 바꾸지 않는다", () => {
  it("말일 수업도 그날 안(한국 시간)에 쓴 것만 — 다음 날 첫 순간부터는 미작성", () => {
    const d = fixture();
    d.reports = [report("2026-09-30", "2026-09-30T14:59:59.999Z")];
    expect(stateOn(d, "2026-09", "2026-09-30")).toBe("own");
    d.reports = [report("2026-09-30", "2026-09-30T15:00:00.000Z")];
    expect([stateOn(d, "2026-09", "2026-09-30"), score(d, "2026-09", "report").value]).toEqual(["missing", 0]);
  });
  it("진행 중인 달도 달 안에서 뒤늦게 보충한 보고서는 미작성이다(당일 작성만 — 원장 2026-10-14)", () => {
    const d = fixture();
    d.reports = [report("2026-10-07", "2026-10-12T00:00:00Z")];
    expect(stateOn(d, "2026-10", "2026-10-07")).toBe("missing");
  });
  it("마감 뒤에 입력한 출결은 처리로 세지 않고, 마감 뒤의 정정이 마감 전 기록을 지우지 않는다", () => {
    const d = fixture();
    d.attendance = [present("2026-09-30", "2026-10-01T00:00:00Z")];
    expect(score(d, "2026-09", "attendance").detail.find((r) => r.day === "2026-09-30")?.done).toBe(false);
    d.attendance = [present("2026-09-30", "2026-09-30T14:59:59Z"), present("2026-09-30", "2026-10-01T00:00:00Z", { id: "b", status: "absent", supersedes_id: "a2026-09-30" })];
    expect(score(d, "2026-09", "report").detail.some((r) => r.day === "2026-09-30")).toBe(true);
  });
  it("마감 뒤에 수정된 상담은 당시 완료 여부를 확정하지 않는다", () => {
    const d = fixture();
    d.consultations = [{ id: "k", student_id: "s", counselor_id: "teacher", consulted_at: "2026-09-15T00:00:00Z", follow_up_date: "2026-09-30", follow_up_done: true, updated_at: "2026-10-01T00:00:00Z" }];
    expect([score(d, "2026-09", "follow").raw, score(d, "2026-09", "follow").value, score(d, "2026-09", "follow").gap]).toEqual([null, 0, "마감 시점 확인"]);
  });
});

describe("기록을 시작하기 전인 달 — 같은 강사의 기준 달 평균", () => {
  const early = () => {
    const d = fixture();
    const aug = wednesdays("2026-08");
    d.reports = [...aug.slice(0, 2), ...wednesdays("2026-09")].map((day) => report(day));
    d.attendance = aug.map((day) => present(day));
    const rule = { before: "2026-07-01", reference: ["2026-08", "2026-09"] };
    d.preRecord = { report: rule, attendance: rule };
    return d;
  };
  it("기준 달은 제 점수를 그대로 갖고, 그 전 달은 항목마다 기준 달 평균을 쓴다", () => {
    const d = early();
    expect([score(d, "2026-08", "report").value, score(d, "2026-09", "report").value]).toEqual([10, 20]);
    expect([score(d, "2026-06", "report").value, score(d, "2026-05", "report").value, score(d, "2026-06", "attendance").value]).toEqual([15, 15, 5]);
    const june = months(d)["2026-06"];
    expect(june.total).toBe(june.items.filter((m) => !m.off).reduce((n, m) => n + (m.value ?? 0), 0));
  });
  it("평균으로 둔 달에는 기록처럼 보이는 줄을 만들지 않고, 근거가 된 달과 점수를 싣는다", () => {
    const june = months(early())["2026-06"];
    const m = metricOf(june, "report");
    expect(m.detail).toEqual([]);
    expect(june.dayStats.every((s) => s.target === 0 && s.missing === 0)).toBe(true);
    expect([m.estimated?.reference.length, (m.estimated?.targets ?? 0) > 0]).toEqual([2, true]);
  });
  it("기록을 시작한 달은 평소대로 계산하고, 시작일이 없으면 아무것도 평균으로 두지 않는다", () => {
    const d = early();
    expect([score(d, "2026-07", "report").value, score(d, "2026-07", "report").estimated]).toEqual([0, undefined]);
    d.preRecord = null;
    expect(score(d, "2026-06", "report").value).toBe(0);
  });
  it("그 달에 대상이 없던 강사는 다른 달과 같이 계산한다", () => {
    const d = early();
    d.enrollments[0].start_date = "2026-07-01";
    expect([score(d, "2026-06", "report").value, score(d, "2026-06", "report").estimated]).toEqual([0, undefined]);
  });
  it("기준 달이 아직 끝나지 않았으면 그 달을 마감하지 않고 기다린다", () => {
    const d = early();
    const june = months(d)["2026-06"];
    expect(awaitsReference(june, d.preRecord, "2026-09")).toBe(false);
    expect(awaitsReference(june, d.preRecord, "2026-08")).toBe(true);
    expect(awaitsReference(months(d)["2026-09"], d.preRecord, "2026-08")).toBe(false);
  });
  it("작성자를 모르는 보고서는 미작성이라 기준 달도 그 점수 그대로 평균에 든다(빼지 않는다 — 작성/미작성만, 원장 2026-10-14)", () => {
    const d = early();
    for (const r of d.reports) r.created_by = null;
    expect([score(d, "2026-08", "report").value, score(d, "2026-09", "report").value, score(d, "2026-06", "report").value]).toEqual([0, 0, 0]);
    expect(months(d)["2026-06"].total === null).toBe(false);
  });
});

describe("프리랜서 근태", () => {
  it("🔴 계약구분이 프리랜서면 근태를 세지 않고 만점 — 출퇴근 재료가 없는 스냅샷이어도(원장 2026-10-16)", () => {
    const punctualityOf = (d: PortfolioSnapshot) => metricOf(build(d).teachers.find((t) => t.name === "강사")!.periods.find((w) => w.month === "2026-09")!, "punctuality");
    const d = fixture();
    d.users[0] = { ...d.users[0], employment_type: "프리랜서" };
    const m = punctualityOf(d);
    expect([m.freelancer, m.value, m.max, m.uncounted, m.detail]).toEqual([true, 10, 10, undefined, []]);
    // 정규직·계약구분 없음은 종전대로(이 스냅샷엔 출퇴근 재료가 없어 계산 전).
    expect([punctualityOf(fixture()).freelancer, punctualityOf(fixture()).uncounted]).toEqual([undefined, true]);
  });

  it("🔴 혼합 계약(근로 + 용역)은 근로 요일만 센다 — 근로 요일이 아닌 날의 지각은 세지 않는다(원장 2026-10-16)", () => {
    const punctualityOf = (d: PortfolioSnapshot) => metricOf(build(d).teachers.find((t) => t.name === "강사")!.periods.find((w) => w.month === "2026-09")!, "punctuality");
    // 수요일 14시 수업 — 9/2(수) 20분 늦게 출근.
    const withLate = (user: Partial<PortfolioSnapshot["users"][number]>) => {
      const d = fixture();
      d.users[0] = { ...d.users[0], ...user };
      d.sources = { grades: [], satisfaction: null, punctuality: { days: wednesdays("2026-09").map((day) => ({
        user_id: "teacher", work_date: day, status: day === "2026-09-02" ? "late" as const : "present" as const, late_minutes: day === "2026-09-02" ? 20 : null,
        check_in_at: `${day}T${day === "2026-09-02" ? "14:20" : "13:50"}:00+09:00`, check_out_at: `${day}T15:00:00+09:00`,
      })), leaves: [], latest: null } };
      return punctualityOf(d);
    };
    expect(withLate({ employment_type: "정규직" }).late).toBe(1);
    // 수요일이 근로 요일이면 그대로 센다 · 아니면(용역 몫 요일) 세지 않는다.
    expect(withLate({ employment_type: "혼합", work_days: ["mon", "wed"] }).late).toBe(1);
    const off = withLate({ employment_type: "혼합", work_days: ["mon", "tue", "thu", "fri"] });
    expect([off.late, off.days, off.freelancer]).toEqual([0, 0, undefined]);
    expect(off.basis).toContain("근로 요일(월·화·목·금)만");
    expect(off.reason).toContain("혼합 계약");
    // 근로 요일을 안 정한 혼합은 일반 직원처럼 모든 요일을 센다.
    expect(withLate({ employment_type: "혼합" }).late).toBe(1);
  });
});
