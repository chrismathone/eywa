/**
 * 학습 · 학부모 보고 카드·상세. 숙제 판정은 운영실 카드와 같은 규칙(`parseHomeworkRate` · 60% 미만)이고,
 * 칸마다의 값은 수업보고서 통계와 같은 집계(`reportTrend`)다 — 명단 줄 수가 카드의 학생 수와 같다.
 */
import { LOW_HOMEWORK_RATE, type HomeworkRisk } from "@/features/dashboard/onescreen/homework-risk";
import { reportStatsHref } from "@/features/dashboard/overview/kpi-links";
import { ratio, type ReportTrend } from "@/features/lesson-reports/stats/report-trend";
import { mondayOf } from "@/features/consultations/stats-recent";
import { bucketLabel } from "@/features/consultations/stats-model";
import { NOT_SUBMITTED, parseHomeworkRate } from "@/features/onescreen/homework-rate";
import { classSubject, monthTable, rosterOf } from "./details-shared";
import { levelOfSchoolGrade, type Detail, type DetailContext, type DetailSeries, type DetailTable } from "./details-types";
import type { HomeworkStudent, ReportCell, ReportExtras } from "./extras-types";
import { monthDay, num, yyMm } from "./labels";

const CELL_KEYS = ["reports", "parsed", "low", "notSubmitted", "zero", "sent", "read", "unread"] as const;

/** 통계의 칸 하나 → 카드 칸. 확인율은 보낸 지 48시간이 지난 보고서만 본다(방금 보낸 것은 아직 확인할 시간이 남았다). */
const cellAt = (t: ReportTrend, i: number): ReportCell => ({
  key: t.keys[i]!, reports: t.reports[i]!, parsed: t.parsed[i]!, low: t.low[i]!, notSubmitted: t.notSubmitted[i]!, zero: t.zero[i]!, sent: t.sentMature[i]!, read: t.read48Mature[i]!, unread: t.unread[i]!,
});
export const reportCells = (t: ReportTrend) => t.keys.map((_, i) => cellAt(t, i));

/** 날 칸을 그 주 월요일로 접는다. 수업이 없던 주도 칸이 남는다. */
export function foldWeeks(days: ReportTrend): ReportCell[] {
  const weeks = new Map<string, ReportCell>();
  for (const day of reportCells(days)) {
    const key = mondayOf(day.key);
    const week = weeks.get(key);
    if (!week) { weeks.set(key, { ...day, key }); continue; }
    for (const k of CELL_KEYS) week[k] += day[k];
  }
  return [...weeks.values()];
}

export type HomeworkRecord = { student_id: string | null; class_id: string | null; subject: string | null; homework_score: string | null; report_date: string };
type Picked = Omit<HomeworkStudent, "name" | "schoolGrade">;

/** 숙제 60% 미만 기록이 한 번이라도 있는 학생 — `buildHomeworkRisk`와 같은 판정을 학생별로 펼친다. */
export function homeworkStudents(records: readonly HomeworkRecord[]): Picked[] {
  const parsed = new Map<string, number>();
  const low = new Map<string, Picked>();
  for (const r of records) {
    if (!r.student_id) continue;
    const raw = (r.homework_score ?? "").trim();
    const rate = parseHomeworkRate(raw);
    if (rate === null) continue;
    parsed.set(r.student_id, (parsed.get(r.student_id) ?? 0) + 1);
    if (rate >= LOW_HOMEWORK_RATE) continue;
    const row = low.get(r.student_id) ?? { id: r.student_id, low: 0, parsed: 0, notSubmitted: 0, zero: 0, last: r.report_date, classes: [] };
    row.low += 1;
    if (raw === NOT_SUBMITTED) row.notSubmitted += 1;
    else if (rate === 0) row.zero += 1;
    if (r.report_date > row.last) row.last = r.report_date;
    if (r.class_id && !row.classes.some((c) => c.classId === r.class_id)) row.classes.push({ classId: r.class_id, subject: r.subject });
    low.set(r.student_id, row);
  }
  return [...low.values()].map((row) => ({ ...row, parsed: parsed.get(row.id) ?? row.low }));
}

/** 카드의 값. 끝 칸은 진행 중인 이번 주다. */
export function reportBoard(report: ReportExtras) {
  const { weeks } = report;
  return {
    rate: report.read && report.read.sent > 0 ? Math.round((report.read.read / report.read.sent) * 100) : null,
    labels: weeks.map((w, i) => (i === weeks.length - 1 ? "이번 주" : bucketLabel(w.key, "week"))),
    values: weeks.map((w) => { const r = ratio(w.low, w.parsed); return r === null ? null : Math.round(r); }),
  };
}

const kindText = (s: HomeworkStudent) => [s.notSubmitted ? `미제출 ${s.notSubmitted}` : "", s.zero ? `0% ${s.zero}` : ""].filter(Boolean).join(" · ") || "60% 미만";

/** 안 낸 횟수 → 낮은 횟수 순. 같으면 이름순. */
function studentTable(students: readonly HomeworkStudent[], windowDays: number, ctx: DetailContext): DetailTable {
  const rows = [...students].sort((a, b) => b.notSubmitted - a.notSubmitted || b.low - a.low || a.name.localeCompare(b.name, "ko"));
  return {
    title: `최근 ${windowDays}일 숙제 60% 미만 학생`, unit: "명",
    cols: ["학생", "반", "담임", "낮은 기록", "구분", "마지막 수업"],
    rows: rows.map((s) => {
      const subject = [...new Set(s.classes.map((c) => classSubject(ctx, c.subject, c.classId)))].filter((name) => name !== "—");
      const who = rosterOf(ctx, s.id, subject[0]);
      return {
        cells: [s.name, who.cls, who.teacher, `${num(s.low)} / ${num(s.parsed)}회`, kindText(s), monthDay(s.last)],
        ...(ctx.can("students") ? { href: `/students/${s.id}`, linkTitle: s.name } : {}),
        subject, level: levelOfSchoolGrade(s.schoolGrade),
      };
    }),
  };
}

/** 🔴 과목·학교급 탭은 명단으로만 나눈다 — 달별 값은 EiE를 가를 수 없어 탭에서 숨는다(`drawerView` — 줄이 없는 표는 남는다). */
export function reportDetail(ctx: DetailContext, homework: (HomeworkRisk & { windowDays: number }) | null, unread: { reports: number; graceHours: number; windowDays: number } | null): Detail {
  const { snapshot } = ctx;
  const report = ctx.extras.report;
  const rate = report && unread ? reportBoard(report).rate : null;
  // 첫 보고서 앞의 달은 기록이 없던 달이다 — 그리지 않는다.
  const months = report ? report.months.slice(Math.max(0, report.months.findIndex((m) => m.reports > 0))) : [];
  const keys = months.map((m) => m.key);
  const series: DetailSeries[] = [
    ...(unread ? [{ name: "48시간 안 확인", values: months.map((m) => ratio(m.read, m.sent)), tone: "m-yellow", stroke: "stroke-yellow" }] : []),
    { name: "숙제 60% 미만 기록", values: months.map((m) => ratio(m.low, m.parsed)), tone: "m-char" },
  ];
  const rateCell = (part: number, whole: number) => { const r = ratio(part, whole); return r === null ? "—" : `${r}%`; };
  return {
    title: "학습 · 학부모 보고", period: homework ? `최근 ${homework.windowDays}일 숙제 · 최근 ${unread?.windowDays ?? 30}일 학부모 확인` : "수업보고서 기준",
    stats: [
      ...(homework ? [["수행률 60% 미만", `${num(homework.students)}명`], ["미제출 학생", `${num(homework.notSubmitted)}명`], ["수행률 0% 학생", `${num(homework.zero)}명`]] as [string, string][] : []),
      ...(rate === null ? [] : [["48시간 안 확인", `${rate}%`]] as [string, string][]),
      ...(unread ? [[`미확인(${unread.graceHours}시간 초과)`, `${num(unread.reports)}건`]] as [string, string][] : []),
    ],
    ...(months.length ? { trend: { title: "달별 숙제 · 학부모 확인", labels: keys.map(yyMm), series, unit: "%", kind: "line" as const, zero: true } } : {}),
    tables: [
      ...(report?.students && homework ? [studentTable(report.students, homework.windowDays, ctx)] : []),
      ...(months.length ? [monthTable(keys, ["달", "보고서", "숙제 60% 미만", "미제출", "0%", ...(unread ? ["48시간 안 확인", "지금 미확인"] : [])], (i) => {
        const m = months[i]!;
        return [`${num(m.reports)}건`, rateCell(m.low, m.parsed), `${num(m.notSubmitted)}건`, `${num(m.zero)}건`, ...(unread ? [rateCell(m.read, m.sent), `${num(m.unread)}건`] : [])];
      })] : []),
    ],
    link: { href: snapshot.teacherView ? "/lesson-reports?tab=list" : reportStatsHref(snapshot.view?.activeSubject), label: "수업보고서 통계에서 보기" },
  };
}
