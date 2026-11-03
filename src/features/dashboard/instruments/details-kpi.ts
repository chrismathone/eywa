/** 맨 위 수치 칸을 눌렀을 때의 상세 — 카드 숫자와 같은 줄을 표로 편다. */
import { levelTestListIn } from "@/features/dashboard/overview/display";
import { previousDayRange, previousDayText } from "@/features/dashboard/overview/previous-day";
import { splitEnrolledRecent } from "@/features/dashboard/overview/enrolled-recent";
import { firstClassTrendHref, intakeTrendHref, makeupWeekHref, withdrawalsMonthHref } from "@/features/dashboard/overview/kpi-links";
import { windowUntilLabel } from "@/features/dashboard/overview/upcoming-window";
import { countWithdrawalPrograms } from "@/features/withdrawals/window";
import { EXIT_REPORT_RULE, countedEarlierTitle, countedMonthLabel, exitBasisRule, exitReportTag, exitReportTitle } from "@/features/withdrawals/exit-basis";
import { absentDaily, makeupWeekly } from "./derive";
import { dash, levelOfSchoolGrade, type DetailContext, type Details } from "./details-types";
import { hhmm, monthDay, num, yyMm } from "./labels";
import { classSubject, compareSlice, oneSeries, onMonths, programName, rosterOf, subjectTab, subjectViews, teacherOfClass } from "./details-shared";

/**
 * 퇴원 상세 맨 아래 셋째 줄(세는 범위 — 합계가 학생 수보다 클 수 있는 까닭). 기존 운영실 팝업(`kpi-popups.tsx`) 맨 아래 셋째 줄과 같은 문장이다 —
 * 그 파일이 글자로 들고 있어 여기 한 벌 더 두고, 시험(`instruments.test.ts`)이 두 문장이 같은지 본다. 공용 상수가 생기면 그것을 쓴다.
 */
export const WITHDRAWAL_SCOPE_NOTE = "과목 수업을 모두 종료한 학생 포함 · 반이동·특강 종료·퇴원일 미상 제외 · 여러 과목을 함께 종료하면 과목마다 1명씩 셉니다.";

export function kpiDetails(ctx: DetailContext): Details {
  const { snapshot, can } = ctx;
  const v = snapshot.sections;
  const today = snapshot.today;
  const out: Details = {};

  const wd = v.withdrawals?.data;
  if (wd) {
    const counts = countWithdrawalPrograms(wd.rows);
    const change = v.changes?.data;
    const long = ctx.extras.longChanges?.length ? ctx.extras.longChanges : change;
    const months = long?.map((r) => r.month) ?? [];
    const lines = ctx.extras.changes;
    const subjectMonths = months.filter((m) => ctx.extras.subjects.some((s) => lines?.[s.key]?.withdrawn[m] !== undefined));
    const trendOf = (l: { key: string }) => (lines?.[l.key] ? onMonths(subjectMonths, lines[l.key]!.withdrawn) : null);
    const by = long && lines
      ? subjectViews(ctx.extras.subjects, subjectMonths, (l) => { const values = trendOf(l); return values ? [oneSeries("퇴원", values, l.key)] : null; }, { title: "월별 퇴원(수강종료 제외)", unit: "명", kind: "bar", note: "과목을 알 수 없는 퇴원은 빠집니다." }, () => [])
      : undefined;
    const compare = long && lines ? compareSlice(ctx.extras.subjects, subjectMonths, trendOf, { title: "과목별 퇴원(수강종료 제외)", unit: "명", note: "과목을 알 수 없는 퇴원은 빠집니다." }) : undefined;
    // 명단 줄 — 앞 달로 센 줄은 날짜 칸에 센 달을 붙인다("10월로 셈"). 구분 = 기존 팝업과 같은 말(퇴원 · 수강종료).
    const rowOf = (r: (typeof wd.rows)[number], counted?: string) => {
      const subject = r.program ? programName(r.program, ctx) : subjectTab(r.subject, ctx);
      const who = rosterOf(ctx, r.id, subject);
      return {
        cells: [r.name, dash(r.schoolGrade), subject, r.className || who.cls, r.className ? teacherOfClass(ctx, r.className) : who.teacher, r.kind === "subject-ended" ? "수강종료" : "퇴원", `${monthDay(r.withdrawnAt.slice(0, 10))}${counted ? ` · ${counted}` : ""}`],
        ...(can("students") ? { href: `/students/${r.id}`, linkTitle: r.name } : {}),
        subject: [subject], level: levelOfSchoolGrade(r.schoolGrade),
      };
    };
    const cols = ["학생", "학교·학년", "과목", "반", "담임", "구분", "마지막 수업일"];
    const carried = wd.carried ?? [];
    // 그 달에 마지막 수업을 했지만 앞 달까지만 내 앞 달로 센 줄의 제목 — 기존 팝업과 같은 말 · 수는 탭으로 거른 줄 수.
    const carriedTitle = (n: number) => `${countedEarlierTitle(wd.month, n, "명")} — 위 숫자에 들지 않습니다`;
    out["kpi:withdrawals"] = {
      // 보여 줄 달 = 서버가 정한 달(`exitReportMonth` — 1~10일은 지난달). 제목·꼬리표 = 기존 운영실 팝업·칸과 같은 말(원장 2026-11-03 "26.10 퇴원(수강종료)" · "지난달 (26.10)").
      title: exitReportTitle(wd.month), period: exitReportTag(wd.month, today),
      stats: [["합계", `${num(counts.total)}명`], ...(["eie", "injaewon", "math"] as const).filter((p) => ctx.eieOn || p !== "eie").map((p): [string, string] => [programName(p, ctx), `${num(counts[p])}명`]), ...(counts.other ? [["기타", `${num(counts.other)}명`] as [string, string]] : [])],
      // 추세 = 달마다 실제 퇴원(수강종료 제외 · 등록·퇴원 추이와 같은 수) — 위 합계(퇴원·수강종료를 과목마다)와 세는 대상이 달라 제목에 밝힌다.
      ...(long ? { trend: { title: "월별 퇴원(수강종료 제외)", labels: months.map(yyMm), series: [{ name: "퇴원", values: long.map((r) => r.withdrawn), tone: "m-char" }], unit: "명", kind: "bar" as const } } : {}),
      ...(by ? { bySubject: Object.fromEntries(Object.entries(by).map(([label, s]) => [label, { trend: s.trend }])) } : {}),
      // 비교 탭 = 추세·달마다 표만 — 위 수치(`compareSlice` = 추세 마지막 달 = 이번 달 값)는 1~10일엔 제목의 달과 다르고, 세는 대상(수강종료 제외)도 위 합계와 달라 뺀다(리뷰 2026-11-03).
      ...(compare ? { compare: { ...compare, stats: [] } } : {}),
      tables: [
        { title: "명단", unit: "명", cols, rows: wd.rows.map((r) => rowOf(r)) },
        // 앞 달로 센 줄 — 위 숫자에도, 과목·학교급 탭과 탭 수치에도 들지 않는다(`aside`).
        ...(carried.length ? [{ title: carriedTitle(carried.length), titleFor: carriedTitle, aside: true, unit: "명", cols, rows: carried.map((r) => rowOf(r, countedMonthLabel(r.countMonth))) }] : []),
      ],
      // 세는 기준 — 기존 팝업 맨 아래 세 줄과 같은 말. 상세 맨 아래에 늘 보인다(명단이 비거나 탭으로 숨어도).
      notes: [EXIT_REPORT_RULE, exitBasisRule(wd.month), WITHDRAWAL_SCOPE_NOTE],
      ...(can("withdrawals") ? { link: { href: withdrawalsMonthHref(wd.month), label: `퇴원관리에서 ${exitReportTitle(wd.month)} 보기` } } : {}),
    };
  }

  const intake = v.intake?.data;
  if (intake) out["kpi:intake"] = {
    title: "신규문의", period: "오늘 접수",
    stats: [["오늘 접수", `${num(intake.length)}건`], ["마지막 접수", intake[0]?.time ?? "—"]],
    tables: [{ title: "접수 목록", cols: ["이름", "접수 시각"], rows: intake.map((r) => ({ cells: [r.name, r.time ?? "—"], ...(can("enrollment") ? { href: `/enrollment/${r.id}`, linkTitle: r.name } : {}) })) }],
    ...(can("enrollment") ? { link: { href: intakeTrendHref(), label: "신규 콜&상담 통계에서 보기" } } : {}),
  };

  const calendar = v.calendar?.data;
  if (calendar) {
    const prev = previousDayRange(today);
    const list = levelTestListIn(calendar, prev);
    out["kpi:calendar"] = {
      title: "전일 입테", period: `전일 · ${previousDayText(prev)}`,
      stats: [["입학 테스트", `${num(list.active.length)}건`], ["취소", `${num(list.cancelled)}건`]],
      tables: [{
        title: "일정", cols: ["날짜", "시각", "일정", "상태"],
        rows: list.rows.map((e) => ({
          cells: [monthDay(e.startDate), hhmm(e.startTime) || "종일", e.displayTitle ?? e.title, e.kind === null ? "취소" : "진행"],
          ...(e.matchedConsultation && can("enrollment") ? { href: `/enrollment/${e.matchedConsultation.id}`, linkTitle: e.matchedConsultation.name } : {}),
          ...(e.kind === null ? { state: "struck" as const } : {}),
        })),
      }],
    };
  }

  // 명단에 없는 반의 과목(학원 설정 이름) → 탭 — 키로 바꿔 다른 카드와 같은 규칙(`subjectTab` · 반을 모르는 영어는 인재원 영어). 모르면 이름 그대로.
  const classTab = (label: string | null) => {
    const key = Object.entries(ctx.snapshot.subjects).find(([k, l]) => l === label || k === label)?.[0];
    const tab = key ? subjectTab(key, ctx) : "—";
    return tab !== "—" ? [tab] : label ? [label] : [];
  };
  const registered = v.enrolledToday?.data;
  if (registered) {
    const recent = splitEnrolledRecent(registered, today);
    const assigned = recent.month.filter((r) => r.assigned).length;
    out["kpi:enrolledToday"] = {
      title: "전일 / 이달 신규", period: `전일 · 이번 달(${Number(today.slice(5, 7))}월)`,
      stats: [["전일", `${num(recent.yesterday.length)}명`], ["이달", `${num(recent.month.length)}명`], ["반 배정", `${num(assigned)}명`], ["배정 전", `${num(recent.month.length - assigned)}명`]],
      tables: [{
        title: "이달 신규", unit: "명", cols: ["학생", "학교·학년", "등록일", "과목", "반", "담임"],
        rows: recent.month.map((r) => {
          const subjects = [...new Set((r.classes ?? []).flatMap((c) => { const tab = ctx.extras.roster?.classSubjects[c.name]; return tab ? [tab] : classTab(c.subject); }))];
          return {
            cells: [r.name, dash(r.schoolGrade), r.date ? monthDay(r.date) : "—", subjects.join("·") || "—", (r.classes ?? []).map((c) => c.name).join("·") || "배정 전", (r.classes ?? []).map((c) => teacherOfClass(ctx, c.name)).join("·") || "—"],
            ...(can("enrollment") ? { href: `/enrollment/${r.id}`, linkTitle: r.name } : {}),
            subject: subjects, level: levelOfSchoolGrade(r.schoolGrade),
          };
        }),
      }],
    };
  }

  const firsts = v.firstClass?.data;
  if (firsts) {
    const first = firsts.filter((r) => r.kind === "first").length;
    out["kpi:firstClass"] = {
      title: "오늘첫수업", period: "오늘",
      stats: [["합계", `${num(firsts.length)}명`], ["첫 등원", `${num(first)}명`], ["처음 듣는 과목", `${num(firsts.length - first)}명`]],
      tables: [{
        title: "명단", unit: "명", cols: ["학생", "구분", "과목", "반", "담임"],
        rows: firsts.map((r) => {
          const who = rosterOf(ctx, r.studentId);
          const subjects = who.subjects.length ? who.subjects : r.subjects.map((s) => subjectTab(s, ctx));
          return { cells: [r.name, r.kind === "first" ? "첫 등원" : "처음 듣는 과목", subjects.join("·") || "—", who.cls, who.teacher], ...(can("students") ? { href: `/students/${r.studentId}`, linkTitle: r.name } : {}), subject: subjects };
        }),
      }],
      ...(can("students") && !snapshot.teacherView ? { link: { href: firstClassTrendHref(snapshot.view?.activeSubject), label: "원생 통계에서 보기" } } : {}),
    };
  }

  const absent = v.absent?.data;
  if (absent) {
    const daily = absentDaily(absent);
    const times = absent.students.reduce((n, s) => n + s.count, 0);
    // 과목 탭 — 결석 한 칸의 과목으로 세므로 표의 줄과 같다.
    const marks = absent.students.flatMap((s) => s.absences.map((a) => ({ who: s.studentId, date: a.date, tab: classSubject(ctx, a.subject, a.classId) })));
    const absentTabs = [...new Set(marks.map((m) => m.tab))].filter((tab) => tab !== "—");
    const absentTrend = { title: "일별 결석", labels: daily.days.map(monthDay), unit: "회", kind: "bar" as const, noRange: true };
    out["kpi:absent"] = {
      title: "최근 결석", period: `${monthDay(absent.from)}~${monthDay(absent.to)} · 어제까지 7일`,
      stats: [["결석 학생", `${num(absent.students.length)}명`], ["결석", `${num(times)}회`], ["연락 필요", `${num(absent.students.filter((s) => s.unnotified > 0).length)}명`]],
      trend: { ...absentTrend, series: [{ name: "결석", values: daily.values, tone: "m-char" }] },
      ...(absentTabs.length > 1 ? { bySubject: Object.fromEntries(absentTabs.map((tab) => {
        const mine = marks.filter((m) => m.tab === tab);
        return [tab, { stats: [["결석 학생", `${num(new Set(mine.map((m) => m.who)).size)}명`], ["결석", `${num(mine.length)}회`]] as [string, string][], trend: { ...absentTrend, series: [{ name: "결석", values: daily.days.map((d) => mine.filter((m) => m.date === d).length), tone: "m-char" }] } }];
      })) } : {}),
      tables: [{
        title: "결석 내역", unit: "회", cols: ["학생", "날짜", "과목", "반", "담임", "담당", "연락"],
        rows: absent.students.flatMap((s) => s.absences.map((a) => {
          const subject = classSubject(ctx, a.subject, a.classId);
          return { cells: [s.name, monthDay(a.date), subject, dash(a.className), teacherOfClass(ctx, a.className), a.teachers.join("·") || "—", a.preNotified ? "사전 통보" : "연락 필요"], ...(can("students") ? { href: `/students/${s.studentId}?tab=attendance`, linkTitle: s.name } : {}), subject: [subject] };
        })),
      }],
    };
  }

  const makeup = v.makeup?.data;
  if (makeup) {
    const weekly = makeupWeekly(makeup.rows, today);
    const makeupTab = (r: (typeof makeup.rows)[number]) => ctx.extras.roster?.students[r.studentId]?.filter((e) => e.className === r.className).map((e) => e.subject) ?? [];
    const makeupTabs = [...new Set(makeup.rows.flatMap(makeupTab))];
    out["kpi:makeup"] = {
      title: "보강예정", period: `오늘부터 ${windowUntilLabel(makeup.range)}`,
      stats: [["예약", `${num(makeup.rows.length)}건`], ["오늘", `${num(makeup.rows.filter((r) => r.makeupDate === today).length)}건`], ["지남", `${num(makeup.rows.filter((r) => r.overdue).length)}건`], ["그 뒤", `${num(makeup.later)}건`]],
      trend: { title: "주별 보강 예약", labels: weekly.labels, series: [{ name: "보강", values: weekly.values, tone: "m-char" }], unit: "건", kind: "bar", noRange: true },
      ...(makeupTabs.length > 1 ? { bySubject: Object.fromEntries(makeupTabs.map((tab) => {
        const mine = makeup.rows.filter((r) => makeupTab(r).includes(tab));
        const w = makeupWeekly(mine, today);
        return [tab, { stats: [["예약", `${num(mine.length)}건`], ["오늘", `${num(mine.filter((r) => r.makeupDate === today).length)}건`]] as [string, string][], trend: { title: "주별 보강 예약", labels: w.labels, series: [{ name: "보강", values: w.values, tone: "m-char" }], unit: "건", kind: "bar" as const, noRange: true } }];
      })) } : {}),
      tables: [{
        title: "예약 목록", cols: ["학생", "학교·학년", "보강일", "시간", "반", "담임", "상태", "예약자"],
        rows: makeup.rows.map((r) => ({
          cells: [r.name, dash(r.schoolGrade), monthDay(r.makeupDate), `${hhmm(r.slotStart)}–${hhmm(r.slotEnd)}`, r.className, teacherOfClass(ctx, r.className), r.overdue ? "지남" : "예정", dash(r.createdByName)],
          ...(can("students") ? { href: `/students/${r.studentId}`, linkTitle: r.name } : {}), level: levelOfSchoolGrade(r.schoolGrade),
          subject: ctx.extras.roster?.students[r.studentId]?.filter((e) => e.className === r.className).map((e) => e.subject),
        })),
      }],
      ...(can("timetable") ? { link: { href: makeupWeekHref(), label: "시간표 보강 탭에서 보기" } } : {}),
    };
  }
  return out;
}
