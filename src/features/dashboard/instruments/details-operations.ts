/** '학원 운영 한눈에' 카드의 상세. */
import { paymentRateDisplay } from "@/features/billing/calc";
import { billingStatsHref, studentsStatsHref } from "@/features/dashboard/overview/kpi-links";
import { processingSummary } from "@/features/dashboard/overview/model";
import { EARLY_MAX_DAYS, EARLY_SPANS, earlyCounts } from "@/features/withdrawals/early-exit";
import { attendanceCompare, attendanceTabs } from "./attendance-slices";
import { careDue, composition, earlyMonthly, noEnrollmentOf } from "./derive";
import { dash, levelOfSchoolGrade, type Detail, type DetailContext, type DetailTable, type Details } from "./details-types";
import { moneyText, monthDay, monthNo, num, yyMm } from "./labels";
import { classSubject, comboTable, compareSlice, compositionTables, courseName, levelStats, monthTable, oneSeries, onMonths, programName, rosterOf, shareStats, subjectViews } from "./details-shared";

export function operationsDetails(ctx: DetailContext): Details {
  const { snapshot, extras, can } = ctx;
  const v = snapshot.sections;
  const view = snapshot.view;
  const stats = { subject: view?.activeSubject, teacherView: snapshot.teacherView };
  const statsLink = (section: Parameters<typeof studentsStatsHref>[0], opts: Parameters<typeof studentsStatsHref>[1] = {}) =>
    can("students") ? { link: { href: studentsStatsHref(section, { ...stats, ...opts }), label: "원생 통계에서 보기" } } : {};
  const out: Details = {};

  const s = v.students?.data;
  const trend = v.enrolledTrend?.data;
  const courseTrend = v.courseTrend?.data;
  const courseNow = v.courses?.data?.basis === "student-subject" ? v.courses.data : null;
  const months = trend?.monthly.map((p) => p.key) ?? [];
  const enrolledTrendView = trend ? { title: "재원생 추이", labels: trend.monthly.map((p) => yyMm(p.key)), series: [oneSeries("재원생", trend.monthly.map((p) => p.count))], unit: "명", kind: "bar" as const } : undefined;
  const enrolledNow = trend?.monthly.at(-1)?.count ?? s?.enrolled ?? null;
  const enrolledViews = (tables: (key: string, values: (number | null)[]) => DetailTable[] | undefined) => (extras.enrolled
    ? subjectViews(extras.subjects, months, (l) => (extras.enrolled![l.key] ? [oneSeries(l.label, onMonths(months, extras.enrolled![l.key]!), l.key)] : null), { title: "재원생 추이", unit: "명", kind: "bar" }, (l, [vals]) => shareStats(`재원생 · ${l.label}`, "명", vals?.at(-1) ?? null, enrolledNow), (l, [vals]) => tables(l.key, vals ?? []))
    : undefined);
  const composed = (key: string) => extras.composition?.[key];
  const enrolledCompare = extras.enrolled ? compareSlice(extras.subjects, months, (l) => (extras.enrolled![l.key] ? onMonths(months, extras.enrolled![l.key]!) : null), { title: "재원생 비교", unit: "명" }) : undefined;

  if (s) {
    const c = composition(s);
    const [levelTable, gradeTable] = compositionTables(s.levelSplit?.rows ?? [], s.gradeSplit.rows);
    const bySubject = enrolledViews((key) => { const c = composed(key); return c ? compositionTables(c.levels, c.grades) : undefined; });
    for (const line of extras.subjects) { const c = composed(line.key); if (c && bySubject?.[line.label]) bySubject[line.label]!.byLevel = levelStats(c.levels, `재원생 · ${line.label}`); }
    const base: Omit<Detail, "title" | "period"> = {
      stats: [["재원생", `${num(s.enrolled)}명`], ...(["eie", "injaewon", "math"] as const).filter((p) => ctx.eieOn || p !== "eie").map((p): [string, string] => [programName(p, ctx), `${num(s.programs[p])}명`]), ["동시 수강", `${num(s.concurrent)}명`], ["미수강", `${num(noEnrollmentOf(s))}명`]],
      ...(enrolledTrendView ? { trend: enrolledTrendView } : {}),
      ...(bySubject ? { bySubject } : {}),
      ...(enrolledCompare ? { compare: enrolledCompare } : {}),
      byLevel: levelStats(s.levelSplit?.rows ?? [], "재원생"),
      tables: [
        levelTable!,
        ...(c.otherOnly ? [{ title: "그 밖의 재원생", cols: ["구분", "인원"], rows: [{ cells: ["기타 과목", `${num(c.otherOnly)}명`] }, { cells: ["미수강", `${num(c.noEnrollment)}명`] }] }] : []),
        gradeTable!,
      ],
      ...statsLink("trend"),
    };
    out["kpi:students"] = { ...base, title: "재원생", period: "현재" };
    out.studentsComp = { ...base, title: "재원생 구성", period: "현재 · 초·중·고 · 영어·동시수강·수학", ...statsLink("trend", { view: "mix" }) };
  }

  if (trend) {
    out.enrolledTrend = {
      title: "재원생 추이", period: "달마다 말일 기준(이번 달은 오늘) · 휴원 제외",
      stats: [["오늘 재원생", `${num(enrolledNow ?? 0)}명`], ...trend.yearly.slice(-3).map((y, i, all): [string, string] => [`${y.label}${i === all.length - 1 ? "(오늘)" : " 말"}`, `${num(y.count)}명`])],
      trend: enrolledTrendView!,
      ...(enrolledViews(() => undefined) ? { bySubject: enrolledViews((_, vals) => [monthTable(months, ["달", "재원생"], (i) => [vals[i] === null || vals[i] === undefined ? "—" : `${num(vals[i]!)}명`])]) } : {}),
      ...(enrolledCompare ? { compare: enrolledCompare } : {}),
      tables: [monthTable(months, ["달", "재원생"], (i) => [`${num(trend.monthly[i]!.count)}명`])],
      ...statsLink("trend"),
    };
  }

  if (courseTrend || courseNow) {
    const keys = courseTrend?.monthly.map((p) => p.key) ?? [];
    const now = courseNow?.total ?? courseTrend?.monthly.at(-1)?.count ?? null;
    const by = extras.courses ? subjectViews(extras.subjects, keys, (l) => (extras.courses![l.key] ? [oneSeries(l.label, onMonths(keys, extras.courses![l.key]!), l.key)] : null), { title: "강좌수 추이", unit: "개", kind: "bar" }, (l, [vals]) => shareStats(`강좌수 · ${l.label}`, "개", vals?.at(-1) ?? null, now), (l, [vals]) => {
      const combos = (courseNow?.combos ?? []).filter((c) => c.parts.some((p) => courseName(p.subject, ctx) === l.label));
      return [monthTable(keys, ["달", "강좌수"], (i) => [vals?.[i] === null || vals?.[i] === undefined ? "—" : `${num(vals[i]!)}개`]), ...(combos.length ? [comboTable(combos, ctx)] : [])];
    }) : undefined;
    const compare = extras.courses ? compareSlice(extras.subjects, keys, (l) => (extras.courses![l.key] ? onMonths(keys, extras.courses![l.key]!) : null), { title: "강좌수 비교", unit: "개" }) : undefined;
    const trendView = courseTrend ? { title: "강좌수 추이", labels: keys.map(yyMm), series: [oneSeries("강좌수", courseTrend.monthly.map((p) => p.count))], unit: "개", kind: "bar" as const } : undefined;
    const base: Omit<Detail, "title" | "period"> = {
      stats: [["강좌수", `${num(now ?? 0)}개`], ...Object.entries(courseNow?.subjects ?? {}).map(([k, n]): [string, string] => [ctx.snapshot.subjects[k] ?? (k === "eie" || k === "injaewon" ? programName(k, ctx) : k), `${num(n)}개`])],
      ...(trendView ? { trend: trendView } : {}),
      ...(by ? { bySubject: by } : {}),
      ...(compare ? { compare } : {}),
      tables: [
        ...(courseNow ? [{ title: "학생당 강좌 수", cols: ["강좌 수", "학생"], rows: courseNow.perStudent.map((b) => ({ cells: [`${b.courses}개`, `${num(b.students)}명`] })) }] : []),
        ...(courseNow ? [comboTable(courseNow.combos, ctx)] : []),
      ],
      ...statsLink("courses"),
    };
    out["kpi:courses"] = { ...base, title: "강좌수", period: "현재 · 학생마다 같은 과목은 1개" };
    if (courseTrend) out.courseTrend = { ...base, title: "강좌수 추이", period: "달마다 말일 기준(이번 달은 오늘)" };
  }

  const change = v.changes?.data;
  if (change) {
    const rows = extras.longChanges?.length ? extras.longChanges : change;
    const keys = rows.map((r) => r.month);
    const subjectKeys = keys.filter((m) => extras.subjects.some((l) => extras.changes?.[l.key]?.enrolled[m] !== undefined));
    const line = (name: string, values: (number | null)[], tone: string, stroke?: string) => ({ name, values, tone, ...(stroke ? { stroke } : {}) });
    const by = extras.changes ? subjectViews(extras.subjects, subjectKeys, (l) => {
      const row = extras.changes![l.key];
      return row ? [line("등록", onMonths(subjectKeys, row.enrolled), "m-yellow", "stroke-yellow"), line("퇴원", onMonths(subjectKeys, row.withdrawn), "m-char")] : null;
    }, { title: "등록·퇴원 추이", unit: "명", kind: "bar", note: "과목을 알 수 없는 등록·퇴원은 빠집니다." }, (l, [en, wd]) => [[`${monthNo(subjectKeys.at(-1) ?? keys.at(-1)!)}월 등록 · ${l.label}`, `${num(en?.at(-1) ?? 0)}명`], ["퇴원", `${num(wd?.at(-1) ?? 0)}명`]], (_, [en, wd]) => [monthTable(subjectKeys, ["달", "등록", "퇴원", "순증"], (i) => {
      const a = en?.[i] ?? 0;
      const b = wd?.[i] ?? 0;
      return [`${num(a)}명`, `${num(b)}명`, `${a - b > 0 ? "+" : ""}${num(a - b)}명`];
    })]) : undefined;
    const compare = extras.changes ? compareSlice(extras.subjects, subjectKeys, (l) => { const row = extras.changes![l.key]; return row ? subjectKeys.map((m) => (row.enrolled[m] ?? 0) - (row.withdrawn[m] ?? 0)) : null; }, { title: "과목별 순증", unit: "명", lineOnly: true, note: "등록 − 퇴원 · 과목을 알 수 없는 등록·퇴원은 빠집니다." }) : undefined;
    out.changes = {
      title: "등록 · 퇴원 추이", period: "달마다 · 당월은 오늘까지",
      stats: [["이번 달 등록", `${num(change.at(-1)?.enrolled ?? 0)}명`], ["이번 달 퇴원", `${num(change.at(-1)?.withdrawn ?? 0)}명`], ["6개월 등록", `${num(change.reduce((n, r) => n + r.enrolled, 0))}명`], ["6개월 퇴원", `${num(change.reduce((n, r) => n + r.withdrawn, 0))}명`]],
      trend: { title: "등록·퇴원 추이", labels: keys.map(yyMm), series: [line("등록", rows.map((r) => r.enrolled), "m-yellow", "stroke-yellow"), line("퇴원", rows.map((r) => r.withdrawn), "m-char")], unit: "명", kind: "bar" },
      ...(by ? { bySubject: by } : {}),
      ...(compare ? { compare } : {}),
      tables: [monthTable(keys, ["달", "등록", "퇴원", "순증"], (i) => { const r = rows[i]!; return [`${num(r.enrolled)}명`, `${num(r.withdrawn)}명`, `${r.enrolled - r.withdrawn > 0 ? "+" : ""}${num(r.enrolled - r.withdrawn)}명`]; })],
      ...statsLink("flow"),
    };
  }

  const billing = v.billing?.data;
  const bill = billing?.at(-1);
  if (billing && bill) {
    const netOf = (r: (typeof billing)[number]) => r.totalBilled - r.totalDiscount, note = "과목을 가리지 못한 청구 항목은 빠집니다.";
    // 금액을 그리나 — 이번 달 카드는 그 카드의 금액 옵션(`monthAmounts`), 6개월 카드는 카드와 같은 `view.amounts`(놓이면 늘 금액).
    const baseFor = (moneyOn: boolean): Omit<Detail, "title" | "period"> => {
      const rows = moneyOn && extras.longBilling?.length ? extras.longBilling : billing;
      const keys = rows.map((r) => r.period);
      const subjectKeys = keys.filter((m) => extras.subjects.some((l) => extras.billing?.[l.key]?.[m] !== undefined));
      const by = moneyOn && extras.billing ? subjectViews(extras.subjects, subjectKeys, (l) => (extras.billing![l.key] ? [oneSeries(`실청구 · ${l.label}`, onMonths(subjectKeys, extras.billing![l.key]!), l.key)] : null), { title: "실청구 추이", money: true, kind: "bar", note }, (l, [vals]) => [[`이번 달 실청구 · ${l.label}`, moneyText(vals?.at(-1) ?? 0)], ...(netOf(bill) ? [["전체 대비", `${Math.round(((vals?.at(-1) ?? 0) / netOf(bill)) * 100)}%`] as [string, string]] : [])], (_, [vals]) => [monthTable(subjectKeys, ["달", "실청구"], (i) => [moneyText(vals?.[i] ?? 0)])]) : undefined;
      const compare = moneyOn && extras.billing ? compareSlice(extras.subjects, subjectKeys, (l) => (extras.billing![l.key] ? onMonths(subjectKeys, extras.billing![l.key]!) : null), { title: "과목별 실청구", money: true, note }) : undefined;
      return {
        stats: moneyOn
          ? [["실청구", moneyText(netOf(bill))], ["수납", moneyText(bill.totalCollected)], ["수납률", `${paymentRateDisplay(bill.paymentRate, bill.outstanding)}%`], ["미수 잔액", moneyText(bill.outstanding)]]
          : [["청구서", `${num(bill.totalCount)}건`], ["완납", `${num(bill.paidCount)}건`], ["부분납", `${num(bill.partialCount)}건`], ["미납", `${num(bill.unpaidCount)}건`]],
        ...(moneyOn && rows.length > 1 ? { trend: { title: "실청구 추이", labels: keys.map(yyMm), series: [oneSeries("실청구", rows.map(netOf))], money: true, kind: "bar" as const } } : {}),
        ...(by ? { bySubject: by } : {}),
        ...(compare ? { compare } : {}),
        tables: [{
          title: "달마다", cols: moneyOn ? ["달", "실청구", "수납", "미수", "수납률"] : ["달", "청구서", "완납", "부분납", "미납"],
          rows: [...rows].reverse().map((r) => ({ cells: moneyOn ? [yyMm(r.period), moneyText(netOf(r)), moneyText(r.totalCollected), moneyText(r.outstanding), `${paymentRateDisplay(r.paymentRate, r.outstanding)}%`] : [yyMm(r.period), `${num(r.totalCount)}건`, `${num(r.paidCount)}건`, `${num(r.partialCount)}건`, `${num(r.unpaidCount)}건`] })),
        }],
        ...(can("billing") ? { link: { href: billingStatsHref(view?.activeSubject), label: "수납 통계에서 보기" } } : {}),
      };
    };
    const month = baseFor(ctx.amounts), money6 = view?.amounts ?? true;
    out.billingMonth = { ...month, title: `${monthNo(bill.period)}월 수납 현황`, period: "이번 달 청구서 · 취소 청구 제외" };
    out.billing6 = { ...(money6 === ctx.amounts ? month : baseFor(money6)), title: "6개월 청구 · 수납", period: money6 ? "청구월 기준 실청구액(청구 − 할인)" : "청구월 기준 청구서 건수" };
  }

  const attendance = v.attendance?.data;
  const processing = v.processing?.data;
  if (v.attendance || v.processing) {
    const sum = processing ? processingSummary(processing) : null;
    const points = v.attendanceTrend?.data;
    const bySubject = attendanceTabs(ctx, (o) => [["기록 칸", `${num(o.snapshot?.total ?? 0)}칸`], ["출석", `${num(o.snapshot?.present ?? 0)}칸`], ["결석", `${num(o.snapshot?.absent ?? 0)}칸`], ["지각", `${num(o.snapshot?.late ?? 0)}칸`]]);
    const compare = attendanceCompare(ctx);
    out.attendance = {
      title: "출결 현황", period: "오늘 · 학생·반·교시별 출결 칸",
      stats: [["기록 칸", `${num(attendance?.total ?? 0)}칸`], ["출석", `${num(attendance?.present ?? 0)}칸`], ["결석", `${num(attendance?.absent ?? 0)}칸`], ["지각", `${num(attendance?.late ?? 0)}칸`], ...(sum ? [["예정학생 미처리", `${num(Math.max(0, sum.expected - sum.recorded))}건`] as [string, string]] : [])],
      ...(points?.length ? { trend: { title: "최근 14일 등원율", labels: points.map((p) => monthDay(p.date)), series: [oneSeries("등원율", points.map((p) => (p.rate === null ? null : Math.round(p.rate))))], unit: "%", kind: "bar" as const, noRange: true } } : {}),
      ...(bySubject ? { bySubject } : {}),
      ...(compare ? { compare } : {}),
      tables: processing ? [{
        title: "반별 처리", unit: "반", cols: ["반", "과목", "담임", "예정", "기록", "미처리"],
        rows: [...processing].sort((a, b) => b.unprocessed - a.unprocessed).map((r) => { const subject = classSubject(ctx, r.subject, r.classId); return { cells: [r.className, subject, dash(r.teacherName), `${num(r.expected)}명`, `${num(r.recorded)}명`, `${num(r.unprocessed)}명`], href: `/classes/${r.classId}`, linkTitle: r.className, subject: [subject] }; }),
      }] : [],
      link: { href: "/attendance/live", label: "오늘 출결 열기" },
    };
  }

  const care = v.newcomers?.data;
  if (care) {
    const due = careDue(care);
    const items = care.items.map((i) => ({ cells: [`${i.label}${i.optional ? " (선택)" : ""}`, `${num(i.done)} / ${num(care.total)}`, `${num(i.overdue)}건`, `${num(i.due)}건`, `${num(i.upcoming + i.pending + i.waived)}건`] }));
    // 같은 학생이 과목마다 한 줄씩 올 수 있다 — 항목마다 한 번만 적는다.
    const needs = care.items.filter((i) => !i.optional).flatMap((i) => [...new Map(i.needs.map((p) => [p.id, p])).values()].map((p) => {
      const who = rosterOf(ctx, p.id);
      return { cells: [p.name, who.cls, who.teacher, i.label], href: `/students/${p.id}`, linkTitle: p.name, subject: who.subjects };
    }));
    const base: Omit<Detail, "title" | "period"> = {
      stats: [["체크 대상", `${num(care.total)}명`], ["기한 경과", `${num(due.overdue)}건`], ["3일 내 기한", `${num(due.due)}건`], ["확인 필요 학생", `${num(due.people)}명`]],
      tables: [{ title: "항목별", cols: ["항목", "완료", "기한 경과", "3일 내", "예정"], rows: items }, { title: "확인이 필요한 학생", unit: "명", cols: ["학생", "반", "담임", "항목"], rows: needs }],
      link: { href: "/newcomers", label: "신규생 관리 열기" },
    };
    out.newcomerStages = { ...base, title: "신규생 단계별 관리", period: "등록 후 90일 · 재원·휴원 학생" };
    out.newcomerChecks = { ...base, title: "신규생 체크 진행", period: "등록 후 90일 · 필수 6항목 · 2개월 콜은 선택" };
  }

  const early = v.earlyExits?.data;
  if (early) {
    const counts = earlyCounts(early.rows);
    const monthly = earlyMonthly(early);
    const rows = [...early.rows, ...(extras.earlyNames ?? [])].filter((r) => r.days !== null && r.days <= EARLY_MAX_DAYS).sort((a, b) => b.withdrawnAt.localeCompare(a.withdrawnAt));
    out.earlyExits = {
      title: "등록 후 3개월 내 퇴원", period: "최근 6개월 · 등록일부터 30·60·90일",
      stats: [["6개월 합계", `${num(monthly.reduce((n, m) => n + m.count, 0))}명`], ...EARLY_SPANS.map((sp): [string, string] => [`이번 달 ${sp.label}`, `${num(counts[sp.key])}명`])],
      trend: { title: "달마다 3개월 내 퇴원", labels: monthly.map((m) => yyMm(m.month)), series: [oneSeries("3개월 내 퇴원", monthly.map((m) => m.count))], unit: "명", kind: "bar" },
      tables: [{ title: "명단", unit: "명", ...(extras.earlyNames ? {} : { note: "이번 달 명단만 보입니다(지난 달 명단은 받지 못했습니다)." }), cols: ["학생", "학교·학년", "반", "담임", "등록일", "퇴원일", "등록 후"], rows: rows.map((r) => { const who = rosterOf(ctx, r.id); return { cells: [r.name, dash(r.schoolGrade), who.cls, who.teacher, r.enrolledAt ? monthDay(r.enrolledAt.slice(0, 10)) : "—", monthDay(r.withdrawnAt.slice(0, 10)), `${num(r.days!)}일`], ...(can("withdrawals") ? { href: `/withdrawals/${r.id}`, linkTitle: `${r.name} 퇴원` } : {}), level: levelOfSchoolGrade(r.schoolGrade), subject: who.subjects }; }) }],
    };
  }
  return out;
}
