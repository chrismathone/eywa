/** '학생 · 학습 · 상담' · '수업과 학원 운영' 카드의 상세. */
import { admissionsStatsHref, attendanceStatsHref, expenseStatsHref, studentsEnrolledHref, studentsStatsHref } from "@/features/dashboard/overview/kpi-links";
import { foldExpenseTotals } from "@/features/dashboard/overview/expense-total";
import { admissionsListKind, upcomingAdmissionsRows } from "@/features/dashboard/overview/display";
import { monthAheadNote, monthAheadWindow } from "@/features/dashboard/overview/upcoming-window";
import { isTestClass } from "@/features/dashboard/overview/test-class";
import { absenceDetail } from "./absence-tree";
import { attendanceCompare, attendanceTabs, dayRows } from "./attendance-slices";
import { consultDetail } from "./consult";
import { consultProgressDetail } from "./consult-progress-detail";
import { attendance14, repeatRows, staffRows, weekdayOf } from "./derive";
import { dash, type DetailContext, type Details } from "./details-types";
import { courseLabel } from "./labels";
import { hhmm, moneyText, monthDay, monthNo, num, yyMm } from "./labels";
import { classSubject, comboTable, compositionTables, courseName, oneSeries, subjectTab } from "./details-shared";
import { reportDetail } from "./report-board";

export function restDetails(ctx: DetailContext): Details {
  const { snapshot, can } = ctx;
  const v = snapshot.sections;
  const view = snapshot.view;
  const today = snapshot.today;
  const out: Details = {};
  const statsRoute = { subject: view?.activeSubject, teacherView: snapshot.teacherView };

  const s = v.students?.data;
  if (s) {
    // 강좌수 칸과 같은 값이라 영어가 EiE · 인재원 영어로 갈린다. 강좌수 칸이 없는 배치만 과목 값으로 적는다.
    const course = v.courses?.data?.basis === "student-subject" ? v.courses.data : null;
    const bySubject = course
      ? Object.entries(course.subjects).sort((a, b) => b[1] - a[1]).map(([k, n]) => { const name = courseName(k, ctx); return { cells: [name, `${num(n)}명`], subject: [name] }; })
      : s.subjects.map((r) => { const name = subjectTab(r.label, ctx); return { cells: [name, `${num(r.value)}명`], subject: [name] }; });
    out.subjects = {
      title: "과목별 수강", period: "현재 재원생 · 과목별 수강과 동시 수강",
      stats: [["재원생", `${num(s.enrolled)}명`], ["동시 수강(영어+수학)", `${num(s.concurrent)}명`], ["미수강", `${num(s.programs.noEnrollment)}명`]],
      tables: [{ title: "과목별", cols: ["과목", "학생"], rows: bySubject }, ...(course ? [comboTable(course.combos, ctx)] : [])],
      ...(can("students") ? { link: { href: studentsStatsHref("trend", { ...statsRoute, view: "subject" }), label: "원생 통계에서 보기" } } : {}),
    };
    const gradeTable = (rows: typeof s.gradeSplit.rows) => compositionTables([], rows)[1]!;
    const composed = ctx.extras.composition;
    out.grades = {
      title: "학년별 재원생", period: "현재 재원생 · 학원설정 학년 순",
      stats: [["재원생", `${num(s.enrolled)}명`], ["영어·수학 밖", `${num(s.gradeSplit.neither)}명`]],
      ...(composed ? { bySubject: Object.fromEntries(ctx.extras.subjects.flatMap((l) => { const c = composed[l.key]; return c ? [[l.label, { stats: [[`재원생 · ${l.label}`, `${num(c.students)}명`]] as [string, string][], tables: [gradeTable(c.grades)] }]] : []; })) } : {}),
      tables: [gradeTable(s.gradeSplit.rows)],
      ...(can("students") ? { link: { href: studentsEnrolledHref(), label: "원생목록 열기" } } : {}),
    };
    const groups = s.schoolGroups ?? [];
    out.schools = {
      title: "학교별 학생", period: "현재 재원생 · 초등·중등·고등",
      stats: groups.map((g): [string, string] => [g.label, `${num(g.total)}명`]),
      tables: [{ title: "학교별", cols: ["학교급", "학교", "학생", "영어만", "동시수강", "수학만"], rows: groups.flatMap((g) => g.schools.map((x) => ({ cells: [g.label, x.label, `${num(x.value)}명`, num(x.subjects?.englishOnly ?? 0), num(x.subjects?.both ?? 0), num(x.subjects?.mathOnly ?? 0)], level: g.label }))) }],
      ...(can("students") ? { link: { href: studentsEnrolledHref(), label: "원생목록 열기" } } : {}),
    };
  }

  const stats = v.admissions?.data;
  if (stats) {
    // 카드는 두 달만 읽는다. 상세는 긴 값으로 — 첫 접수 앞의 달은 기록이 없던 달이라 그리지 않는다. 위 수치는 카드와 같은 두 달이다.
    const long = ctx.extras.longAdmissions;
    const months = long ? long.slice(Math.max(0, long.findIndex((m) => m.total > 0))) : stats.months;
    out.admissions = {
      title: "신규 콜&상담 전환", period: "위 수치는 지난달 · 이번 달 합계 · 접수일 기준",
      stats: [["접수", `${num(stats.total)}건`], ["등록", `${num(stats.enrolled)}건`], ["전환율", stats.rate === null ? "—" : `${stats.rate}%`]],
      trend: { title: "월별 접수·등록", labels: months.map((m) => yyMm(m.month)), series: [oneSeries("접수", months.map((m) => m.total)), { name: "등록", values: months.map((m) => m.enrolled), tone: "m-yellow", stroke: "stroke-yellow" }], unit: "건", kind: "bar" },
      tables: [{ title: "달마다", cols: ["달", "접수", "등록", "전환율", "진행", "미등록", "미방문"], rows: [...months].reverse().map((m) => ({ cells: [yyMm(m.month), `${num(m.total)}건`, `${num(m.enrolled)}건`, m.rate === null ? "—" : `${m.rate}%`, `${num(m.open)}건`, `${num(m.declined)}건`, `${num(m.noShow)}건`], ...(can("enrollment") ? { href: `/enrollment?view=table&month=${m.month}`, linkTitle: "신규 콜&상담" } : {}) })) }],
      ...(can("enrollment") && !snapshot.teacherView && !view?.subjectScoped ? { link: { href: admissionsStatsHref(), label: "신규 콜&상담 통계에서 보기" } } : {}),
    };
  }

  const absences = v.absences?.data;
  if (absences) out.repeatAbsence = absenceDetail(absences, repeatRows(absences.rows), ctx);

  const points = v.attendanceTrend?.data;
  if (points) {
    const a = attendance14(points);
    const bySubject = attendanceTabs(ctx, (o) => { const p = attendance14(o.trend); return [["등원율", `${p.value}%`], ["출석 + 지각", `${num(p.attended)}칸`], ["유효", `${num(p.valid)}칸`]]; }, (o) => [{ title: "날마다", cols: ["날짜", "등원율", "기록 칸"], rows: dayRows(o) }]);
    const compare = attendanceCompare(ctx);
    out.attendance14 = {
      title: "최근 14일 등원율", period: "오늘 포함 14일 · (출석 + 지각) / 유효 출결 칸",
      stats: [["등원율", `${a.value}%`], ["출석 + 지각", `${num(a.attended)}칸`], ["유효", `${num(a.valid)}칸`]],
      trend: { title: "날마다 등원율", labels: points.map((p) => monthDay(p.date)), series: [oneSeries("등원율", a.days.map((d) => d[1]))], unit: "%", kind: "bar", noRange: true },
      ...(bySubject ? { bySubject } : {}),
      ...(compare ? { compare } : {}),
      tables: [{ title: "날마다", cols: ["날짜", "요일", "등원율", "기록 칸"], rows: [...points].reverse().map((p) => ({ cells: [monthDay(p.date), weekdayOf(p.date), p.rate === null ? "—" : `${Math.round(p.rate)}%`, `${num(p.total)}칸`] })) }],
      link: { href: snapshot.teacherView ? "/attendance" : attendanceStatsHref(view?.activeSubject), label: "출석부 통계에서 보기" },
    };
  }

  const consult = v.consultProgress?.data;
  if (consult) out.consultProgress = consultProgressDetail(consult, ctx);

  const homework = v.homework?.data;
  const unread = v.unread?.data;
  if (homework || unread) out.reports = reportDetail(ctx, homework ?? null, unread ?? null);

  const consults = v.consultations?.data;
  if (consults) out.studentConsult = consultDetail(consults, ctx);

  const sheets = ([["영어 시트", v.englishSheet?.data, "교시"], ["수학 시트", v.mathSheet?.data, "학생·수업일"]] as const).flatMap(([label, d, unit]) => (d ? [{ label, d, unit }] : []));
  if (sheets.length) out.sheets = {
    title: "강사 시트 작성 현황", period: "영어 이번 주 · 수학 이번 달",
    stats: sheets.map(({ label, d }): [string, string] => [label, d.total ? `${Math.round((d.filled / d.total) * 100)}%` : "—"]),
    tables: [{ title: "시트별", cols: ["시트", "기간", "반", "작성", "전체"], rows: sheets.map(({ label, d, unit }) => ({ cells: [label, d.period, `${num(d.classes)}개 반`, `${num(d.filled)}`, `${num(d.total)} ${unit}`] })) }],
  };

  // 테스트 반은 수업이 아니다 — 카드와 같은 거르기.
  const schedule = v.schedule?.data?.filter((r) => !isTestClass(r.className));
  if (schedule) out.nowClasses = {
    title: "현재 수업 현황", period: "오늘 시간표",
    stats: [["진행 중", `${num(schedule.filter((r) => r.status === "ongoing").length)}개`], ["예정", `${num(schedule.filter((r) => r.status === "upcoming").length)}개`], ["끝남", `${num(schedule.filter((r) => r.status === "done").length)}개`]],
    tables: [{ title: "오늘 전체", cols: ["시간", "반", "과목", "담당", "강의실", "상태"], rows: [...schedule].sort((a, b) => a.startTime.localeCompare(b.startTime)).map((r) => { const subject = classSubject(ctx, r.subject, r.classId); return { cells: [`${hhmm(r.startTime)}–${hhmm(r.endTime)}`, r.className, subject, r.teacherName ?? "강사 미정", r.classroomName ?? "교실 미정", { done: "끝남", ongoing: "진행 중", upcoming: "예정" }[r.status]], href: `/classes/${r.classId}`, linkTitle: r.className, subject: [subject], state: r.status === "done" ? ("muted" as const) : r.status === "ongoing" ? ("now" as const) : undefined }; }) }],
    ...(can("timetable") ? { link: { href: "/timetable", label: "시간표 열기" } } : {}),
  };

  if (v.calendar?.data) {
    const rows = upcomingAdmissionsRows(v.calendar.data, today).filter((e) => admissionsListKind(e));
    out.admissionsSchedule = {
      title: "레벨테스트 및 첫수업 일정", period: monthAheadNote(monthAheadWindow(today)),
      stats: [["입학 테스트", `${num(rows.filter((e) => e.kind === "levelTest").length)}건`], ["첫 수업", `${num(rows.filter((e) => e.kind === "firstClass").length)}건`], ["취소", `${num(rows.filter((e) => e.kind === null).length)}건`]],
      tables: [{ title: "일정", cols: ["날짜", "시각", "구분", "일정", "상태"], rows: rows.map((e) => { const link = e.matchedClass ? { href: `/classes/${e.matchedClass.id}`, linkTitle: e.matchedClass.name } : e.matchedConsultation && can("enrollment") ? { href: `/enrollment/${e.matchedConsultation.id}`, linkTitle: e.matchedConsultation.name } : {}; return { cells: [monthDay(e.startDate), hhmm(e.startTime) || "종일", admissionsListKind(e) === "levelTest" ? "입학 테스트" : "첫 수업", e.displayTitle ?? e.title, e.kind === null ? "취소" : "예정"], ...link, state: e.kind === null ? ("struck" as const) : e.startDate === today ? ("now" as const) : undefined }; }) }],
    };
  }

  const staff = v.staff?.data;
  if (staff) {
    const g = staffRows(staff);
    out.staff = {
      title: "직원 구성", period: "현재 재직 중 · 운영 역할 기준",
      stats: [["재직 직원", `${num(g.total)}명`]],
      tables: [{ title: "역할별", cols: ["역할", ...g.series, "합계"], rows: staff.map((r, i) => ({ cells: [r.label, ...g.rows[i]![1].map((n) => `${num(n)}명`), `${num(r.value)}명`] })) }],
      ...(can("staff") ? { link: { href: "/staff", label: "직원관리 열기" } } : {}),
    };
  }

  const ops = v.operations?.data;
  if (ops) out.operations = {
    title: "행정 · 자산", period: "현재 · 누적 건수 · 열람 가능한 업무 기준", stats: [],
    tables: [{ title: "업무별", cols: ["업무", "건수"], rows: ops.map((o) => ({ cells: [o.label, o.count === null ? "조회 실패" : `${num(o.count)}${o.unit}`], href: o.href, linkTitle: o.label })) }],
  };

  const expenses = v.expenses?.data;
  if (expenses) {
    const total = foldExpenseTotals(expenses.byCurrency);
    const unit = expenses.primaryCurrency === "KRW" ? "" : ` ${expenses.primaryCurrency}`;
    out.expenses = {
      title: `${monthNo(today.slice(0, 7))}월 지출 내역`, period: `이번 달 · 지출일 기준 · ${num(expenses.count)}건`,
      stats: [["지출 합계", moneyText(total.krwTotal)], ["건수", `${num(expenses.count)}건`], ...total.unconverted.map((c): [string, string] => [`${c.currency} 합계`, `${num(c.total)} ${c.currency}`])],
      tables: [{ title: "분류별", cols: ["분류", "금액", "건수"], rows: expenses.byCategory.map((c) => ({ cells: [c.category, unit ? `${num(c.amount)}${unit}` : moneyText(c.amount), `${num(c.count)}건`] })) }],
      ...(can("billing") ? { link: { href: expenseStatsHref(), label: "지출 통계에서 보기" } } : {}),
    };
  }

  const notices = v.notices?.data;
  if (notices) out.notices = {
    title: "학원 공지", period: "최근 공지 · 대상 권한 반영", stats: [],
    tables: [{ title: "공지", cols: ["제목", "날짜", "내용"], rows: notices.map((n) => ({ cells: [n.title, monthDay(n.createdAt.slice(0, 10)), n.content] })) }],
    link: { href: "/dashboard/announcements", label: "공지 관리 열기" },
  };

  const work = ctx.extras.teacherWork;
  if (work) out.teacherWork = {
    title: "강사별 업무 현황", period: "현재 담당 반 · 보고서·영상 숙제 최근 7일 · 출결 어제까지 7일", stats: [],
    tables: [{ title: "강사별", cols: ["강사", "과목", "반", "보고서", "출결 미입력", "영상 제출"], rows: work.rows.map((r) => { const subject = courseLabel(r.subject, ctx.snapshot.subjects, ctx.subjects, ctx.eieOn); return { cells: [dash(r.teacherName), subject, `${num(r.classIds.length)}반`, `${num(r.reports)} / ${num(r.reportTarget)}`, `${num(r.attendanceUnrecorded)} / ${num(r.attendanceDays)}`, `${num(r.videoSubmitted)} / ${num(r.videoAssigned)}`], subject: [subject] }; }) }],
    link: { href: "/class-review?tab=work", label: "업무 현황 열기" },
  };
  return out;
}
