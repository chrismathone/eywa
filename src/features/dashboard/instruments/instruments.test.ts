import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT_REPORT_RULE, exitBasisRule } from "@/features/withdrawals/exit-basis";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { programSubjectsOf } from "@/features/students/enrollment/program";
import { buildHomeworkRisk } from "@/features/dashboard/onescreen/homework-risk";
import { checkRows } from "./check-board";
import { consultBoard, consultSubjectMonths, pendingOf } from "./consult";
import { foldWeeks, homeworkStudents, reportBoard } from "./report-board";
import { absentDaily, admissionMonths, attendance14, careDue, composition, earlyMonthly, consultSteps, gradeColumns, makeupWeekly, newDates, repeatRows, scheduleWeeks, schoolGroups, staffRows, timeline, TIMELINE_ROWS, withdrawalHead } from "./derive";
import { buildDetails, withExtras } from "./details";
import { WITHDRAWAL_SCOPE_NOTE } from "./details-kpi";
import { ALL, COMPARE, drawerView, filterRows, numberColumns, shareStats } from "./details-shared";
import type { Detail, DetailContext } from "./details-types";
import { levelOfSchoolGrade } from "./details-types";
import { NO_EXTRAS } from "./extras-types";
import { courseLabel, moneyText, programKeyOf, yyMm } from "./labels";
import { teacherBoard, teacherTabs } from "./teacher-board";
import { FIXTURE_EXTRAS, FIXTURE_SNAPSHOT } from "./testing/fixture";

const v = FIXTURE_SNAPSHOT.sections;
const subjects = programSubjectsOf(FIXTURE_SNAPSHOT.subjects);
const ctx = (over: Partial<DetailContext> = {}, snapshot: OverviewSnapshot = FIXTURE_SNAPSHOT): DetailContext => ({
  snapshot: withExtras(snapshot, over.extras ?? FIXTURE_EXTRAS), extras: FIXTURE_EXTRAS, can: () => true, subjects, eieOn: true, amounts: true, ...over,
});

describe("표기", () => {
  it("금액은 억·만으로 적는다", () => {
    expect(moneyText(124_000_000)).toBe("1.24억");
    expect(moneyText(11_000_000)).toBe("1,100만");
    expect(moneyText(22_474_900)).toBe("2,247만");
    expect(moneyText(3_000)).toBe("3,000원");
  });
  it("추이 가로축은 yy.mm", () => expect(yyMm("2026-09")).toBe("26.09"));
  it("학교·학년 표기에서 학교급을 읽는다", () => {
    expect(levelOfSchoolGrade("경명여중1")).toBe("중등");
    expect(levelOfSchoolGrade("칠곡초")).toBe("초등");
    expect(levelOfSchoolGrade("고3")).toBe("고등");
    expect(levelOfSchoolGrade("미입력")).toBeUndefined();
  });
  it("영어는 반 구분으로 EiE·인재원 영어로 가른다 · 구분을 안 쓰는 학원은 영어 하나", () => {
    expect(programKeyOf("english", "eie", subjects, true)).toBe("eie");
    expect(programKeyOf("english", null, subjects, true)).toBe("injaewon");
    expect(programKeyOf("english", "eie", subjects, false)).toBe("english");
    expect(programKeyOf("math", null, subjects, true)).toBe("math");
    expect(courseLabel("eie", FIXTURE_SNAPSHOT.subjects, subjects, true)).toBe("EiE");
    expect(courseLabel("없는키", FIXTURE_SNAPSHOT.subjects, subjects, true)).toBe("기타 과목");
  });
});

describe("카드 값", () => {
  const s = v.students!.data!;
  it("재원생 구성 합계 = 운영실 막대 합계", () => {
    const c = composition(s);
    expect(c.noEnrollment).toBe(8);
    expect(c.otherOnly).toBe(42);
    expect(c.total).toBe(s.levelSplit!.rows.reduce((n, r) => n + r.englishOnly + r.both + r.mathOnly, 0) + 50);
    expect(c.rows.at(-1)).toEqual(["미수강", [0, 0, 0, 0, 8]]);
  });
  it("과목 관리자 화면의 학원 전체 값은 academy 쪽을 쓴다", () => {
    expect(composition({ ...s, academy: { enrolled: 500, noEnrollment: 3 } }).noEnrollment).toBe(3);
  });
  it("학년 칸은 값이 있는 학년만, 학교급 띠는 연속으로 묶는다", () => {
    const g = gradeColumns(s);
    expect(g.rows).toHaveLength(12);
    expect(g.groups.map((x) => [x[0], x[1]])).toEqual([["초등", 6], ["중등", 3], ["고등", 3]]);
  });
  it("학교는 학교급마다 다섯 + 나머지", () => {
    const g = schoolGroups(s);
    expect(g[0]!.schools).toHaveLength(5);
    expect(g[0]!.rest).toEqual([["F초", 6]]);
  });
  it("상담 전환은 달력 키로 고른다", () => {
    const m = admissionMonths(v.admissions!.data!, "2026-11-02");
    expect(m.map((x) => x.key)).toEqual(["2026-10", "2026-11"]);
    expect(m[0]!.rate).toBe("20.5%");
    expect(admissionMonths({ ...v.admissions!.data!, months: [] }, "2026-11-02")[0]!.parts).toBeNull();
  });
  it("반복 결석은 사전 통보를 뺀 횟수로 묶는다", () => {
    expect(repeatRows(v.absences!.data!.rows)).toEqual([["3회", 1], ["4회", 0], ["5회 이상", 1]]);
  });
  it("14일 등원율은 기록 칸으로 가중 평균하고 기록 없는 날은 빈칸이다", () => {
    const a = attendance14([{ date: "2026-10-01", rate: 100, total: 90 }, { date: "2026-10-02", rate: null, total: 0 }, { date: "2026-10-03", rate: 50, total: 10 }]);
    expect(a).toMatchObject({ value: 95, valid: 100, attended: 95 });
    expect(a.days[1]).toEqual(["2026-10-02", null]);
  });
  it("입테를 못 센 달은 단계에서 뺀다", () => {
    expect(consultSteps({ received: 3, consulted: 2, levelTest: null, enrolled: 1, assigned: 1, started: 0 }).map((x) => x[0])).toEqual(["접수", "상담", "등록", "반 배정", "수업 시작"]);
  });
  it("신규생 확인 필요는 사람으로 세고 선택 항목은 뺀다", () => {
    expect(careDue(v.newcomers!.data!)).toEqual({ overdue: 3, due: 2, people: 1 });
  });
  it("현재 수업은 진행 중인 반만, 없으면 곧 시작할 반", () => {
    const slot = (i: number, status: "ongoing" | "upcoming" | "done") => ({ id: `${i}`, classId: `${i}`, className: `반${i}`, subject: "math", startTime: "16:00:00", endTime: "17:00:00", teacherName: null, classroomName: null, status });
    const name = () => ({ key: "math", label: "수학" });
    const many = [...Array.from({ length: 5 }, (_, i) => slot(i, "done")), ...Array.from({ length: 8 }, (_, i) => slot(i + 10, "upcoming")), ...Array.from({ length: 9 }, (_, i) => slot(i + 30, "ongoing"))];
    expect(timeline(many, "16:30", name).rows).toHaveLength(9);
    expect(timeline(many, "16:30", name).rows.every((r) => Number(r.name.slice(1)) >= 30)).toBe(true);
    const later = timeline(many.filter((s) => s.status !== "ongoing"), "15:00", name);
    expect(later).toMatchObject({ running: 0 });
    expect(later.rows).toHaveLength(TIMELINE_ROWS);
    expect(timeline([], "15:00", name).rows[0]?.room).toBeUndefined();
  });
  it("일정은 주별로 묶고 취소는 숫자에서 뺀다", () => {
    const rows = v.calendar!.data!.filter((e) => e.endDate >= "2026-11-02");
    const w = scheduleWeeks(rows, "2026-11-02");
    expect(w.labels[0]).toBe("11/2~");
    expect(w.tests[0]).toBe(1);
    expect(w.firsts[1]).toBe(1);
    expect(w).toMatchObject({ total: 2, cancelled: 1 });
  });
  it("직원 조각은 값이 있는 과목 묶음만", () => {
    const g = staffRows(v.staff!.data!);
    expect(g.series).toEqual(["영어", "수학", "과목 없음"]);
    expect(g.total).toBe(14);
  });
  it("결석은 날짜로만 나눠 합계가 카드와 같다", () => {
    const d = absentDaily(v.absent!.data!);
    expect(d.values.reduce((a, b) => a + b, 0)).toBe(3);
    expect(d.labels).toHaveLength(7);
  });
  it("보강은 7일씩 나누고 지난 건은 첫 칸에 든다", () => {
    const row = (makeupDate: string) => ({ makeupDate }) as never;
    expect(makeupWeekly([row("2026-10-30"), row("2026-11-02"), row("2026-11-10")], "2026-11-02")).toEqual({ labels: ["이번 주", "2주", "3주", "4주"], values: [2, 1, 0, 0] });
    expect(makeupWeekly([row("2026-12-01")], "2026-11-02").labels).toHaveLength(5);
  });
  it("신규 등록일은 날짜 순·날짜 없는 줄 제외", () => {
    expect(newDates([{ date: "2026-11-09" }, { date: null }, { date: "2026-11-02" }])).toEqual(["11/02", "11/09"]);
  });
  it("강사 게이지는 높을수록 좋음으로 맞추고 값이 없는 칸은 빈칸이다", () => {
    const b = teacherBoard(FIXTURE_EXTRAS.teacherWork!, (k) => k);
    expect(b.metrics.map((m) => m.name)).toEqual(["보고서 작성", "발송 완료", "학부모 확인", "출결 입력", "영상 제출", "영상 숙제 출제"]);
    expect(b.metrics[3]!.cells[1]).toEqual([11, 12]);
    const notice = { ...FIXTURE_EXTRAS.teacherWork!, deliveryShown: false, rows: [{ ...FIXTURE_EXTRAS.teacherWork!.rows[0]!, reportSource: "classnote" as const, attendanceDays: 0 }] };
    const n = teacherBoard(notice, (k) => k);
    expect(n.metrics.map((m) => m.name)).toEqual(["보고서 작성", "출결 입력", "영상 제출", "영상 숙제 출제"]);
    expect(n.metrics[1]!.cells[0]).toBeNull();
    expect(n.metrics[3]!.cells[0]).toBeNull();
  });
});

describe("상세", () => {
  const details = buildDetails(ctx());
  it("카드·수치 칸마다 상세가 있고 빈 값 글자가 새지 않는다", () => {
    for (const key of ["students", "courses", "withdrawals", "intake", "calendar", "enrolledToday", "firstClass", "absent", "makeup"]) expect(details[`kpi:${key}`], key).toBeDefined();
    for (const key of ["studentsComp", "attendance", "billingMonth", "newcomerStages", "changes", "billing6", "earlyExits", "enrolledTrend", "courseTrend", "subjects", "grades", "schools", "admissions", "repeatAbsence", "attendance14", "consultProgress", "reports", "studentConsult", "newcomerChecks", "sheets", "nowClasses", "admissionsSchedule", "staff", "operations", "expenses", "notices", "teacherWork"]) expect(details[key], key).toBeDefined();
    expect(JSON.stringify(details)).not.toMatch(/undefined|NaN|\[object/);
  });
  it("값이 안 온 카드는 상세도 없다", () => {
    const sections = { ...FIXTURE_SNAPSHOT.sections };
    delete sections.withdrawals;
    expect(buildDetails(ctx({ extras: NO_EXTRAS }, { ...FIXTURE_SNAPSHOT, sections }))["kpi:withdrawals"]).toBeUndefined();
  });
  it("퇴원 상세 = 서버가 준 달 그대로 · 제목·꼬리표·기준 문장·링크는 기존 운영실 칸·팝업과 같은 말 · 앞 달로 센 줄은 따로(숫자에 안 든다)", () => {
    const plain = details["kpi:withdrawals"]!;
    expect([plain.title, plain.period]).toEqual(["26.10 퇴원(수강종료)", "지난달 (26.10)"]);
    expect(plain.tables).toHaveLength(1);
    expect(plain.notes).toEqual([EXIT_REPORT_RULE, exitBasisRule("2026-10"), WITHDRAWAL_SCOPE_NOTE]);
    expect(plain.link?.label).toBe("퇴원관리에서 26.10 퇴원(수강종료) 보기");
    expect(plain.tables[0]!.rows.map((r) => r.cells[5])).toEqual(["퇴원", "수강종료"]);
    // 비교 탭 = 추세·달마다 표만(위 수치 없음 — 추세 마지막 달은 이번 달이라 1~10일엔 제목의 달과 다르다).
    expect(plain.compare?.trend?.title).toBe("과목별 퇴원(수강종료 제외)");
    expect(drawerView(plain, COMPARE, ALL).stats).toEqual([]);
    const base = FIXTURE_SNAPSHOT.sections.withdrawals!;
    const rows = base.data!.rows;
    const carried = [{ ...rows[0]!, id: "w3", name: "학생 다", withdrawnAt: "2026-10-02", countMonth: "2026-09" }];
    const sections = { ...FIXTURE_SNAPSHOT.sections, withdrawals: { ...base, data: { month: "2026-10", rows, carried } } };
    const d = buildDetails(ctx({}, { ...FIXTURE_SNAPSHOT, sections }))["kpi:withdrawals"]!;
    expect(d.stats[0]).toEqual(["합계", "2명"]);
    expect(d.tables.map((t) => t.title)).toEqual(["명단", "마지막 수업일이 10월이지만 앞 달로 센 1명 — 위 숫자에 들지 않습니다"]);
    expect(d.tables[1]!.rows[0]!.cells.at(-1)).toBe("10/2 · 9월로 셈");
    // 과목·학교급을 골라도 수치는 그 달로 센 줄만 — 앞 달로 센 줄이 섞이지 않는다.
    expect(drawerView(d, ALL, "중등").stats).toEqual([["명단", "1명"]]);
  });
  it("그 달로 센 줄이 없고 앞 달로 센 줄만 있어도 — 탭·탭 수치·기준 문장이 그 줄에 끌려가지 않는다(리뷰 2026-11-03)", () => {
    const base = FIXTURE_SNAPSHOT.sections.withdrawals!;
    const [first, second] = base.data!.rows;
    const carried = [{ ...first!, id: "w3", withdrawnAt: "2026-10-01", countMonth: "2026-09" }, { ...second!, id: "w4", withdrawnAt: "2026-10-02", countMonth: "2026-09" }];
    const sections = { ...FIXTURE_SNAPSHOT.sections, withdrawals: { ...base, data: { month: "2026-10", rows: [], carried } } };
    const d = buildDetails(ctx({}, { ...FIXTURE_SNAPSHOT, sections }))["kpi:withdrawals"]!;
    expect(d.notes?.[0]).toBe(EXIT_REPORT_RULE);
    const whole = drawerView(d, ALL, ALL);
    expect(whole.levels).toEqual([]);
    expect(whole.tables.map((t) => [t.title, t.rows.length])).toEqual([["명단", 0], ["마지막 수업일이 10월이지만 앞 달로 센 2명 — 위 숫자에 들지 않습니다", 2]]);
    const one = drawerView(d, "수학", ALL);
    expect(one.stats).toEqual([["명단", "0명"]]);
    expect(one.tables.map((t) => [t.title, t.rows.length])).toEqual([["명단", 0], ["마지막 수업일이 10월이지만 앞 달로 센 1명 — 위 숫자에 들지 않습니다", 1]]);
  });
  it("퇴원 칸 머리 = 기존 칸과 같은 이름·꼬리표(앞말 + 달) · 노란 칸은 위 숫자의 달(1~10일은 지난달 · 막대가 없으면 칠하지 않는다)", () => {
    const change = ["2026-09", "2026-10", "2026-11"].map((month) => ({ month }));
    expect(withdrawalHead("2026-10", "2026-11-02", change)).toEqual({ label: "퇴원", period: "(26.10)", periodLead: "지난달", emphasis: 1 });
    expect(withdrawalHead("2026-11", "2026-11-11", change)).toEqual({ label: "퇴원", period: "(26.11)", periodLead: "이번달", emphasis: 2 });
    expect(withdrawalHead("2026-08", "2026-11-02", change).emphasis).toBe(-1);
    expect(withdrawalHead("2026-10", "2026-11-02", null).emphasis).toBe(-1);
  });
  it("범위 문장 = 기존 운영실 팝업 맨 아래 셋째 줄과 같은 글자(팝업 파일이 글자로 들고 있다 — 한쪽만 고치면 실패)", () => {
    expect(readFileSync(join(process.cwd(), "src/app/(shell)/dashboard/_overview/kpi-popups.tsx"), "utf8")).toContain(WITHDRAWAL_SCOPE_NOTE);
  });
  it("과목 값은 달 키로 맞춘다 — 없는 달은 빈칸", () => {
    const by = details.courseTrend!.bySubject!["EiE"]!;
    expect(by.trend!.series[0]!.values.at(-1)).toBe(64);
    expect(shareStats("x", "명", null, 0)).toEqual([["오늘 x", "0명"]]);
    const short = { ...FIXTURE_EXTRAS, enrolled: { eie: { "2026-11": 64 } } };
    const d = buildDetails(ctx({ extras: short })).enrolledTrend!;
    expect(d.bySubject!["EiE"]!.trend!.series[0]!.values.slice(-2)).toEqual([null, 64]);
  });
  it("권한이 없으면 링크가 없다", () => {
    const d = buildDetails(ctx({ can: () => false }));
    expect(d["kpi:withdrawals"]!.link).toBeUndefined();
    expect(d["kpi:withdrawals"]!.tables[0]!.rows[0]!.href).toBeUndefined();
  });
  it("금액을 가린 역할은 건수만 본다", () => {
    const text = JSON.stringify(buildDetails(ctx({ amounts: false })).billingMonth);
    expect(text).toContain("청구서");
    expect(text).not.toMatch(/억|실청구/);
  });
  it("스냅샷에 값이 있으면 추가 값으로 덮지 않는다", () => {
    const early = { month: "2026-11", months: [], rows: [], history: [] };
    const snapshot = { ...FIXTURE_SNAPSHOT, sections: { ...FIXTURE_SNAPSHOT.sections, earlyExits: { data: early, at: 1, error: false } } };
    expect(withExtras(snapshot, FIXTURE_EXTRAS).sections.earlyExits!.data).toBe(early);
    expect(withExtras(FIXTURE_SNAPSHOT, NO_EXTRAS).sections.earlyExits).toBeUndefined();
  });
});

describe("상세 탭", () => {
  const details = buildDetails(ctx());
  const wd = details["kpi:withdrawals"] as Detail;
  it("표에 있는 값으로만 탭을 세운다", () => {
    const view = drawerView(wd, ALL, ALL);
    expect(view.subjects).toEqual(expect.arrayContaining(["EiE", "수학"]));
    expect(view.levels).toEqual(["중등", "초등"]);
    expect(drawerView(details.operations!, ALL, ALL).levels).toEqual([]);
  });
  it("학교급을 고르면 표와 수치가 같이 바뀌고 가를 수 없는 추세는 숨는다", () => {
    const view = drawerView(wd, ALL, "중등");
    expect(view.tables[0]!.rows).toHaveLength(1);
    expect(view.stats).toEqual([["명단", "1명"]]);
    expect(view.trend).toBeUndefined();
  });
  it("과목을 고르면 그 과목 추세가 나오고 수치는 줄 수를 따른다", () => {
    const view = drawerView(wd, "수학", ALL);
    expect(view.trend!.series[0]!.values.at(-2)).toBe(6);
    expect(view.stats).toEqual([["명단", "1명"]]);
  });
  it("과목 값이 있는 상세는 그 값을 쓴다", () => {
    const view = drawerView(details.courseTrend!, "EiE", ALL);
    expect(view.stats[0]).toEqual(["오늘 강좌수 · EiE", "64개"]);
  });
  it("과목 탭을 누르면 표도 그 과목 값으로 바뀐다", () => {
    const view = drawerView(details["kpi:students"] as Detail, "수학", ALL);
    expect(view.trend!.series[0]!.values.at(-1)).toBe(183);
    expect(view.tables.map((t) => t.table.title)).toEqual(["학교급별 구성", "학년별 구성"]);
    expect(view.tables[0]!.rows[0]!.cells).toEqual(["초등", "0", "22", "20", "42"]);
    expect(view.stats[0]).toEqual(["오늘 재원생 · 수학", "183명"]);
    const trend = drawerView(details.enrolledTrend!, "EiE", ALL);
    expect(trend.tables[0]!.rows[0]!.cells).toEqual(["26.11", "64명"]);
  });
  it("과목과 학교급을 함께 고르면 둘 다 걸린다", () => {
    const view = drawerView(details["kpi:students"] as Detail, "수학", "중등");
    expect(view.stats[0]).toEqual(["재원생 · 수학", "95명"]);
    expect(view.tables[0]!.rows.map((r) => r.cells[0])).toEqual(["중등"]);
    expect(view.trend).toBeUndefined();
  });
  it("학교급만 고르면 그 학교급 수치 · 못 가르는 표는 숨긴다", () => {
    const view = drawerView(details["kpi:students"] as Detail, ALL, "고등");
    expect(view.stats[0]).toEqual(["재원생", "58명"]);
    expect(view.tables.map((t) => t.table.title)).not.toContain("그 밖의 재원생");
  });
  it("과목으로 못 가르는 표는 전체 값을 남기지 않는다", () => {
    const view = drawerView(details["kpi:courses"] as Detail, "수학", ALL);
    expect(view.tables.map((t) => t.table.title)).not.toContain("학생당 강좌 수");
    expect(view.tables.find((t) => t.table.title === "과목 수강 조합")!.rows.every((r) => r.cells[0]!.includes("수학"))).toBe(true);
  });
  it("학생 명단에는 반과 담임이 있다", () => {
    const cols = (key: string, i = 0) => details[key]!.tables[i]!.cols;
    for (const key of ["kpi:withdrawals", "kpi:enrolledToday", "kpi:firstClass", "kpi:absent", "kpi:makeup", "earlyExits"]) {
      expect(cols(key), key).toEqual(expect.arrayContaining(["반", "담임"]));
    }
    // 반복 결석은 담임 → 반 → 학생 계층이고, 계층 값이 없는 화면은 명단으로 남는다.
    expect(cols("repeatAbsence")[0]).toBe("담임 · 반 · 학생");
    const plain = buildDetails(ctx({ extras: { ...FIXTURE_EXTRAS, absenceLines: null } })).repeatAbsence!;
    expect(plain.tables[0]!.cols).toEqual(expect.arrayContaining(["반", "담임"]));
    const needs = details.newcomerChecks!.tables.find((t) => t.title === "확인이 필요한 학생")!;
    expect(needs.cols).toEqual(["학생", "반", "담임", "항목"]);
    expect(needs.rows).toHaveLength(1);
    expect(needs.rows[0]!.cells).toEqual(["학생 자", "초5 영어", "강사 나", "사전 콜"]);
    expect(details["kpi:withdrawals"]!.tables[0]!.rows[0]!.cells[4]).toBe("강사 가");
  });
  it("강사 탭은 고른 과목 열만 남긴다", () => {
    const label = (k: string) => ({ english: "영어", math: "수학" })[k] ?? k;
    expect(teacherTabs(FIXTURE_EXTRAS.teacherWork!, label, ["수학", "영어"])).toEqual(["수학", "영어"]);
    expect(teacherBoard(FIXTURE_EXTRAS.teacherWork!, label, ["수학", "영어"], "수학").teachers.map((t) => t.name)).toEqual(["강사 다", "강사 라"]);
  });
  it("비교는 과목을 한 그래프·한 표에 놓는다", () => {
    const view = drawerView(details.enrolledTrend!, COMPARE, ALL);
    expect(view.subjects.at(-1)).toBe(COMPARE);
    expect(view.trend!.series.map((s) => s.name)).toEqual(["EiE", "인재원 영어", "수학", "과학"]);
    expect(view.tables[0]!.table.cols).toEqual(["달", "EiE", "인재원 영어", "수학", "과학"]);
    expect(view.stats[2]).toEqual(["수학", "183명"]);
    expect(view.levels).toEqual([]);
    const net = drawerView(details.changes!, COMPARE, ALL).trend!;
    expect(net.lineOnly).toBe(true);
  });
  it("상세 기간은 긴 값을 쓰고 카드 수치는 그대로다", () => {
    expect(details.changes!.trend!.labels).toHaveLength(14);
    expect(details.billing6!.trend!.labels).toHaveLength(14);
    expect(details["kpi:withdrawals"]!.trend!.labels).toHaveLength(14);
    expect(details.changes!.stats[0]).toEqual(["이번 달 등록", "0명"]);
  });
  it("과목 칸에 영어가 남지 않는다", () => {
    const names = (key: string) => drawerView(details[key]!, ALL, ALL).subjects;
    for (const key of ["subjects", "kpi:absent", "kpi:firstClass", "kpi:enrolledToday", "attendance", "nowClasses", "consultProgress", "repeatAbsence"]) expect(names(key), key).not.toContain("영어");
    expect(names("subjects")).toEqual(expect.arrayContaining(["EiE", "인재원 영어", "수학"]));
  });
  it("3개월 내 퇴원은 달마다 세고 지난 달 명단까지 나온다", () => {
    const monthly = earlyMonthly(FIXTURE_EXTRAS.earlyExits!);
    expect(monthly.at(-1)).toEqual({ month: "2026-11", count: 1 });
    expect(monthly.find((m) => m.month === "2026-10")!.count).toBe(1);
    const d = details.earlyExits!;
    expect(d.trend!.series[0]!.values.at(-2)).toBe(1);
    expect(d.tables[0]!.rows.map((r) => r.cells[0])).toEqual(["학생 가", "학생 아"]);
  });
  it("끝난 수업은 흐리게 · 취소는 줄 긋기 · 오늘은 강조", () => {
    const now = details.nowClasses!.tables[0]!.rows;
    expect(now.filter((r) => r.state === "now")).toHaveLength(2);
    const plan = details.admissionsSchedule!.tables[0]!.rows;
    expect(plan.find((r) => r.cells.at(-1) === "취소")!.state).toBe("struck");
    const today = { ...FIXTURE_SNAPSHOT, today: "2026-11-05" };
    const rows = buildDetails(ctx({}, today)).admissionsSchedule!.tables[0]!.rows;
    expect(rows.find((r) => r.cells[0] === "11/5")!.state).toBe("now");
  });
  it("학생 상담은 목록 요약 띠와 같은 값 · 담임 표는 EiE를 가른다", () => {
    const board = consultBoard(FIXTURE_EXTRAS.consult!, "2026-11-02");
    expect(board.rate).toBe(3);
    expect(board.recent).toBe(142);
    expect(board.change).toBe("+4%");
    expect(board.labels.at(-1)).toBe("이번 주");
    const d = details.studentConsult!;
    expect(d.stats[0]).toEqual(["담임 상담 이번 달", "3%"]);
    expect(d.trend!.labels).toHaveLength(12);
    const view = drawerView(d, ALL, ALL);
    expect(view.subjects).toEqual(expect.arrayContaining(["EiE", "인재원 영어", "수학"]));
    expect(view.subjects).not.toContain("영어");
    expect(d.tables[0]!.rows.map((r) => r.cells[0])).toEqual(["강사 다", "강사 나", "강사 가"]);
    expect(d.tables[0]!.rows[1]!.cells[1]).toBe("EiE·인재원 영어");
    const eie = drawerView(d, "EiE", ALL);
    expect(eie.stats).toEqual([["담임 상담 이번 달", "3%"], ["담임", "1명"], ["이번 달 상담", "2건"]]);
    expect(eie.trend!.title).toBe("달별 상담");
    expect(eie.tables.map((t) => t.table.title)).toEqual(["담임별 상담", "이번 달 담임 상담 안 한 학생"]);
  });
  it("신규 콜&상담 상세는 긴 달을 쓰고 위 수치는 카드와 같은 두 달이다", () => {
    const d = details.admissions!;
    expect(d.trend!.labels).toHaveLength(14);
    expect(d.trend!.labels[0]).toBe("25.10");
    expect(d.trend!.labels.at(-1)).toBe("26.11");
    expect(d.stats[0]).toEqual(["접수", "83건"]);
    expect(d.tables[0]!.rows[0]!.cells.slice(0, 4)).toEqual(["26.11", "39건", "6건", "15%"]);
    const short = buildDetails(ctx({ extras: { ...FIXTURE_EXTRAS, longAdmissions: null } })).admissions!;
    expect(short.trend!.labels).toEqual(["26.10", "26.11"]);
  });
  it("과목 탭을 누르면 추세도 그 과목 값으로 바뀐다", () => {
    const math = drawerView(details.attendance!, "수학", ALL);
    expect(math.trend!.series[0]!.values.at(-1)).toBe(95);
    expect(math.trend!.labels).toHaveLength(14);
    expect(math.stats[0]).toEqual(["기록 칸", "90칸"]);
    expect(math.tables[0]!.rows.every((r) => r.subject?.includes("수학"))).toBe(true);
    expect(drawerView(details.attendance!, "EiE", ALL).stats[0]).toEqual(["기록 칸", "0칸"]);
    expect(drawerView(details.attendance!, ALL, ALL).subjects).toEqual(expect.arrayContaining(["수학", "인재원 영어", "EiE", COMPARE]));
    const compare = drawerView(details.attendance!, COMPARE, ALL);
    expect(compare.trend!.series.map((s) => s.name)).toEqual(["수학", "인재원 영어", "EiE"]);
    const day = drawerView(details.attendance14!, "수학", ALL);
    expect(day.trend!.series[0]!.values.at(-1)).toBe(95);
    expect(day.tables[0]!.rows[0]!.cells).toEqual(["11/2", "95%", "60칸"]);
    const absent = drawerView(details["kpi:absent"]!, "수학", ALL);
    expect(absent.trend!.series[0]!.values.reduce((a, b) => a! + b!, 0)).toBe(2);
    expect(absent.stats).toEqual([["결석 학생", "1명"], ["결석", "2회"]]);
    const makeup = drawerView(details["kpi:makeup"]!, "수학", ALL);
    expect(makeup.trend!.series[0]!.values[0]).toBe(1);
    expect(makeup.stats).toEqual([["예약", "1건"], ["오늘", "1건"]]);
    const consult = drawerView(details.studentConsult!, "EiE", ALL);
    expect(consult.trend!.series[0]!.values.at(-2)).toBe(20);
    expect(consult.trend!.note).toContain("인재원 영어");
    expect(drawerView(details.studentConsult!, COMPARE, ALL).trend!.series).toHaveLength(3);
  });
  it("학생 상담 탭은 수학부터 · 최근 석 달 상담이 없는 옛 과목은 탭이 없다", () => {
    const consult = FIXTURE_EXTRAS.consult!;
    const bySubject = { ...consult.bySubject!, science: [4, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    const d = buildDetails(ctx({ extras: { ...FIXTURE_EXTRAS, consult: { ...consult, bySubject } } })).studentConsult!;
    expect(drawerView(d, ALL, ALL).subjects).toEqual(["수학", "인재원 영어", "EiE", COMPARE]);
  });
  it("상담은 적힌 과목이 먼저고 영어는 반의 구분으로 가른다", () => {
    const keyOf = (s: string | null, t: string | null) => programKeyOf(s, t, subjects, true);
    const classes = new Map([["e", { subject: "english", english_track: "eie" }], ["m", { subject: "math", english_track: null }]]);
    const row = (subject: string | null, class_id: string | null, consulted_at = "2026-10-10T03:00:00Z") => ({ consulted_at, subject, class_id });
    const out = consultSubjectMonths([row("english", "e"), row("english", null), row("math", "e"), row(null, "m"), row(null, null), row("math", null, "2026-09-30T14:59:00Z"), row("math", null, "2026-09-30T15:00:00Z")], ["2026-09", "2026-10"], classes, keyOf);
    expect(out).toEqual({ eie: [0, 1], injaewon: [0, 1], math: [1, 3] });
  });
  it("확인할 일은 카드 값을 그대로 읽고 0건 줄은 세우지 않는다", () => {
    const rows = checkRows(ctx());
    expect(rows.map((r) => r.key)).toEqual(["absence", "billing", "homework", "homeroom", "followup", "stalled", "tasks"]);
    const at = (key: string) => rows.find((r) => r.key === key)!;
    expect(at("absence")).toMatchObject({ target: "2명", basis: "사전 통보 제외 7회 · 반 2 · 담임 2", owner: "담임 2명", detail: "repeatAbsence" });
    expect(at("billing").title).toBe("10월 미납 · 부분납");
    expect(at("homework").owner).toBe("담임 2명");
    expect(at("homeroom")).toMatchObject({ title: "지난달부터 담임 상담 없는 학생", target: "2명", owner: "담임 2명", detail: "studentConsult" });
    expect(at("tasks").basis).toBe("보고서 발송 실패 2 · 결석 확인 전화 1");
    expect(checkRows(ctx({ extras: { ...FIXTURE_EXTRAS, taskBoard: null, consult: null }, amounts: false })).map((r) => r.key)).not.toContain("tasks");
    const none = { ...FIXTURE_SNAPSHOT, sections: {} };
    expect(checkRows(ctx({ extras: NO_EXTRAS }, none))).toEqual([]);
  });
  it("결석 계층 — 담임 → 반 → 학생 · 합은 줄과 같다 · 탭이 표와 추세를 바꾼다", () => {
    const d = details.repeatAbsence!;
    expect(d.stats[1]).toEqual(["사전 통보 제외", "7회"]);
    expect(d.trend!.labels).toHaveLength(14);
    const rows = d.tables[0]!.rows;
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 2, 0, 1, 2]);
    expect(rows[0]!.cells).toEqual(["강사 가 · 수학", "2명", "6회", "7회", "4회"]);
    expect(rows[1]!.parent).toBe(rows[0]!.id);
    expect(rows[2]!.parent).toBe(rows[1]!.id);
    expect(rows[2]!.cells[0]).toBe("학생 아 · A중3");
    const math = drawerView(d, "수학", ALL);
    expect(math.tables[0]!.rows.filter((r) => r.depth === 0)).toHaveLength(1);
    expect(math.trend!.series[0]!.values.reduce((a, b) => a! + b!, 0)).toBe(6);
  });
  it("상담 안 한 학생은 지난달부터 없는 학생이 먼저", () => {
    const d = details.studentConsult!;
    expect(d.stats.map(([k]) => k)).toEqual(expect.arrayContaining(["지난달 담임 상담", "지난달부터 없음"]));
    const t = d.tables.find((x) => x.title === "이번 달 담임 상담 안 한 학생")!;
    expect(t.rows.map((r) => r.cells[0])).toEqual(["학생 라", "학생 마", "학생 사"]);
    expect(t.rows[0]!.cells[3]).toBe("다른 직원만");
    expect(pendingOf([{ id: "a", name: "가", grade: null, cells: ["none", "self"], selfCounts: [], lastSelf: null, otherNames: [] }, { id: "b", name: "나", grade: null, cells: ["self", "before"], selfCounts: [], lastSelf: null, otherNames: [] }, { id: "c", name: "다", grade: null, cells: ["self", "other"], selfCounts: [], lastSelf: "2026-10-01", otherNames: [] }])).toEqual([{ id: "c", name: "다", grade: null, prev: "self", last: "2026-10-01" }]);
  });
  it("글자 열은 왼쪽 · 숫자 열은 오른쪽", () => {
    const row = (...cells: string[]) => ({ cells });
    const set = numberColumns([row("가", "중2 수학 A", "강사 가", "2 / 3회", "미제출 2", "10/30", "1,234건", "41 / 52 (79%)", "1.13억", "—"), row("나", "—", "—", "1 / 2회", "0% 1", "11/1", "3건", "—", "2,248만", "—")]);
    expect([...set]).toEqual([3, 6, 7, 8]);
  });
  it("숙제 명단은 운영실 카드와 같은 판정이다", () => {
    const records = [
      { student_id: "a", class_id: "k1", subject: "math", homework_score: "미제출", report_date: "2026-10-30" },
      { student_id: "a", class_id: "k1", subject: "math", homework_score: "0%", report_date: "2026-10-31" },
      { student_id: "a", class_id: "k1", subject: "math", homework_score: "100%", report_date: "2026-11-01" },
      { student_id: "b", class_id: "k2", subject: "math", homework_score: "59", report_date: "2026-10-30" },
      { student_id: "c", class_id: "k2", subject: "math", homework_score: "60", report_date: "2026-10-30" },
      { student_id: "d", class_id: "k2", subject: "math", homework_score: "일부 미흡", report_date: "2026-10-30" },
      { student_id: "e", class_id: "k2", subject: "math", homework_score: "없음", report_date: "2026-10-30" },
      { student_id: null, class_id: "k2", subject: "math", homework_score: "미제출", report_date: "2026-10-30" },
    ];
    const list = homeworkStudents(records);
    const risk = buildHomeworkRisk(records.filter((r) => r.student_id).map((r) => ({ studentId: r.student_id!, homeworkScore: r.homework_score })));
    expect(list).toHaveLength(risk.students);
    expect(list.filter((s) => s.notSubmitted > 0)).toHaveLength(risk.notSubmitted);
    expect(list.filter((s) => s.zero > 0)).toHaveLength(risk.zero);
    expect(list.find((s) => s.id === "a")).toMatchObject({ low: 2, parsed: 3, notSubmitted: 1, zero: 1, last: "2026-10-31" });
  });
  it("보고서 날 칸은 월요일 주로 접힌다", () => {
    const days = ["2026-10-25", "2026-10-26", "2026-11-01", "2026-11-02"];
    const t = Object.fromEntries(["reports", "parsed", "low", "notSubmitted", "zero", "unparsed", "sent", "read48", "unread", "sentMature", "read48Mature"].map((k) => [k, days.map(() => 1)]));
    const weeks = foldWeeks({ keys: days, ...t } as unknown as Parameters<typeof foldWeeks>[0]);
    expect(weeks.map((w) => [w.key, w.low])).toEqual([["2026-10-19", 1], ["2026-10-26", 2], ["2026-11-02", 1]]);
  });
  it("학습 · 학부모 보고 상세 — 명단은 카드와 같은 축 · 탭은 EiE를 가른다", () => {
    const board = reportBoard(FIXTURE_EXTRAS.report!);
    expect(board.rate).toBe(74);
    expect(board.labels.at(-1)).toBe("이번 주");
    expect(board.values[0]).toBe(18);
    const d = details.reports!;
    expect(d.stats.map(([k]) => k)).toContain("48시간 안 확인");
    expect(d.trend!.series.map((s) => s.name)).toEqual(["48시간 안 확인", "숙제 60% 미만 기록"]);
    expect(d.trend!.labels[0]).toBe("26.02");
    const list = d.tables[0]!;
    expect(list.cols).toEqual(["학생", "반", "담임", "낮은 기록", "구분", "마지막 수업"]);
    expect(list.rows[0]!.cells).toEqual(["학생 마", "중2 수학 A", "강사 가", "2 / 3회", "미제출 2", "10/30"]);
    expect(list.rows.map((r) => r.cells[4])).toEqual(["미제출 2", "60% 미만", "0% 1"]);
    const view = drawerView(d, ALL, ALL);
    expect(view.subjects).toEqual(expect.arrayContaining(["수학", "EiE"]));
    expect(view.subjects).not.toContain("영어");
    const eie = drawerView(d, "EiE", ALL);
    expect(eie.stats).toEqual([[list.title, "1명"]]);
    expect(eie.trend).toBeUndefined();
    expect(eie.tables).toHaveLength(1);
  });
  it("학습 · 학부모 보고 값이 없는 화면은 수치만 남는다", () => {
    const d = buildDetails(ctx({ extras: { ...FIXTURE_EXTRAS, report: null } })).reports!;
    expect(d.tables).toEqual([]);
    expect(d.trend).toBeUndefined();
    expect(d.stats.map(([k]) => k)).not.toContain("48시간 안 확인");
  });
  it("학생 상담 추세는 첫 기록 앞의 달을 그리지 않는다", () => {
    const consult = FIXTURE_EXTRAS.consult!;
    const months = consult.months.map((m, i) => (i < 2 ? { ...m, n: 0 } : m));
    const d = buildDetails(ctx({ extras: { ...FIXTURE_EXTRAS, consult: { ...consult, months } } })).studentConsult!;
    expect(d.trend!.labels).toHaveLength(10);
    expect(d.trend!.series[0]!.values[0]).toBe(110);
  });
  it("학생 상담 값이 없는 화면은 수치만 남는다", () => {
    const d = buildDetails(ctx({ extras: { ...FIXTURE_EXTRAS, consult: null } })).studentConsult!;
    expect(d.tables).toEqual([]);
    expect(d.trend).toBeUndefined();
    expect(d.stats.map(([k]) => k)).toEqual(["최근 7일", "이번 달", "기한 경과", "기한 예정"]);
  });
  it("표시가 없는 표는 거르지 않는다", () => {
    expect(filterRows({ title: "달마다", cols: [], rows: [{ cells: ["a"] }] }, "수학", "중등")).toHaveLength(1);
  });
});
