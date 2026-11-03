/** 상세가 함께 쓰는 재료 — 과목 이름, 월별 표, 과목 탭. */
import { programLabel, type Program } from "@/features/students/enrollment/program";
import { intakeGroupMeta, intakeGroupsOf } from "@/features/enrollment/intake-groups";
import type { SplitRow } from "./extras-types";
import { levelOfSchoolGrade, type Detail, type DetailContext, type DetailRow, type DetailSeries, type DetailSlice, type DetailTable, type DetailTrend, type MonthValues } from "./details-types";
import { courseLabel, moneyText, num, programKeyOf, subjectStyle, yyMm } from "./labels";

export const ALL = "전체";
export const COMPARE = "비교";
const uniq = (list: (string | undefined)[]) => [...new Set(list.filter((x): x is string => !!x))];

/** 그 축 표시가 있는 표만 거른다. 달별 표처럼 표시가 없는 표는 그대로 둔다. */
export function filterRows(table: DetailTable, subject: string, level: string): DetailRow[] {
  const bySubject = subject !== ALL && table.rows.some((r) => r.subject?.length);
  const byLevel = level !== ALL && table.rows.some((r) => r.level);
  return table.rows.filter((r) => (!bySubject || r.subject?.includes(subject)) && (!byLevel || r.level === level));
}

/**
 * 상세 창이 그릴 값. 탭은 표에 실제로 있는 값으로만 세운다(값이 하나뿐이면 탭이 없다).
 * 🔴 탭을 고르면 수치·추세·표가 함께 바뀐다(원장 2026-11-02 *"상단 누르면 하단이 안바뀌고 추이만 바뀜. 같이 바뀌게"*).
 *    그 조건의 값이 없는 추세·표는 전체 값을 남기지 않고 숨긴다 — 표는 1명인데 위 수치가 합계 2명이면 같은 화면이 두 말을 한다. 비율로 나눈 값은 만들지 않는다.
 */
export function drawerView(detail: Detail, subject: string, level: string) {
  const rows = detail.tables.flatMap((t) => t.rows);
  const subjects = [...uniq([...Object.keys(detail.bySubject ?? {}), ...rows.flatMap((r) => r.subject ?? [])]), ...(detail.compare ? [COMPARE] : [])];
  if (subject === COMPARE && detail.compare) {
    const c = detail.compare;
    return { stats: c.stats ?? [], trend: c.trend, subjects, levels: [] as string[], tables: (c.tables ?? []).map((table) => ({ table, rows: table.rows })) };
  }
  const sub = subject === ALL ? undefined : detail.bySubject?.[subject];
  const replaced = !!sub?.tables;
  const tables = (sub?.tables ?? detail.tables).flatMap((table) => {
    if (subject !== ALL && !replaced && !table.rows.some((r) => r.subject?.length)) return [];
    if (level !== ALL && !table.rows.some((r) => r.level)) return [];
    return [{ table, rows: filterRows(table, replaced ? ALL : subject, level) }];
  });
  const first = tables.find(({ table }) => table.rows.some((r) => (level !== ALL ? r.level : r.subject?.length)));
  const counted: [string, string][] = first ? [[first.table.title, `${first.rows.length.toLocaleString("ko-KR")}${first.table.unit ?? "건"}`]] : [];
  const levelStats = level === ALL ? undefined : subject === ALL ? detail.byLevel?.[level] : sub?.byLevel?.[level];
  return {
    stats: levelStats ?? (level !== ALL ? counted : subject === ALL ? detail.stats : (sub?.stats ?? counted)),
    trend: level !== ALL ? undefined : subject === ALL ? detail.trend : sub?.trend,
    subjects,
    levels: uniq(rows.map((r) => r.level)),
    tables,
  };
}

const NUMBER_CELL = /^[+-]?[\d,.]+\s*(?:억|만|원|건|명|개|회|칸|반|일|%)?(?:\s+\/\s+[\d,.]+\s*(?:건|명|개|회|칸|반|%)?)?(?:\s+\(\d+%\))?$/;

/** 숫자를 견주는 열(첫 열 제외). 그 밖의 열은 글자라 왼쪽에 선다 — 제목도 값과 같은 쪽이다. */
export function numberColumns(rows: readonly DetailRow[]): Set<number> {
  const out = new Set<number>();
  for (let j = 1, n = rows[0]?.cells.length ?? 0; j < n; j += 1) {
    const cells = rows.map((r) => r.cells[j] ?? "—").filter((c) => c !== "—");
    if (cells.length && cells.every((c) => NUMBER_CELL.test(c.trim()))) out.add(j);
  }
  return out;
}

/** 학생의 반·담임. 과목을 주면 그 과목 반을 고른다(없으면 전부). */
export function rosterOf(ctx: DetailContext, studentId: string, subject?: string) {
  const all = ctx.extras.roster?.students[studentId] ?? [];
  const picked = subject ? all.filter((e) => e.subject === subject) : [];
  const list = picked.length ? picked : all;
  return { cls: uniq(list.map((e) => e.className)).join("·") || "—", teacher: uniq(list.map((e) => e.teacher ?? undefined)).join("·") || "—", subjects: uniq(all.map((e) => e.subject)) };
}

/** 반 이름 → 담임. */
export const teacherOfClass = (ctx: DetailContext, className: string | null | undefined) => (className ? ctx.extras.roster?.classTeachers[className] : undefined) ?? "—";

/** 수강 한 줄의 과목 탭 이름 — 어느 표에서나 탭과 같은 이름이다. */
export function classSubject(ctx: DetailContext, subject: string | null | undefined, classId: string) {
  const key = programKeyOf(subject, ctx.extras.eieClassIds.includes(classId) ? "eie" : null, ctx.subjects, ctx.eieOn);
  return key ? courseLabel(key, ctx.snapshot.subjects, ctx.subjects, ctx.eieOn) : "—";
}

export const courseName = (key: string, ctx: DetailContext) => courseLabel(key, ctx.snapshot.subjects, ctx.subjects, ctx.eieOn);

export function comboTable(combos: readonly { parts: { subject: string; count: number }[]; students: number }[], ctx: DetailContext): DetailTable {
  return { title: "과목 수강 조합", unit: "개", cols: ["조합", "학생"], rows: combos.map((c) => ({ cells: [c.parts.map((p) => `${courseName(p.subject, ctx)}${p.count > 1 ? ` ${p.count}` : ""}`).join(" + "), `${num(c.students)}명`], subject: c.parts.map((p) => courseName(p.subject, ctx)) })) };
}

/** 과목 키 → 탭 이름. 반을 모르는 영어는 인재원 영어다('EiE가 아닌 전부' — `programOf`와 같은 규칙). */
export const subjectTab = (key: string | null | undefined, ctx: DetailContext) => {
  const k = programKeyOf(key, null, ctx.subjects, ctx.eieOn);
  return k ? courseName(k, ctx) : "—";
};

/**
 * 콜&상담 과목 칸(자유 입력) → 과목 묶음 이름들 — 신규 콜&상담 통계 · 관리현황과 같은 판정(`intakeGroupsOf` · 'EIE' = 영어 · '영어 수학' = 둘 다)
 * · 이름도 같은 곳(`intakeGroupMeta` — 학원 설정 이름). 못 읽는 글자('영수' · '고등특강')는 묶음이 없다(전체에서만 보인다).
 * 재료 = 학원 설정의 과목(추가 값 `settingSubjects` — 학원 범위 화면에만 온다).
 */
export function consultGroupsOf(ctx: DetailContext): (text: string | null | undefined) => string[] {
  const list = ctx.extras.settingSubjects ?? [];
  const groupsOf = intakeGroupsOf(list);
  const meta = intakeGroupMeta(list);
  return (text) => groupsOf(text).map((g) => meta[g]?.label ?? g);
}

const splitCells = (r: SplitRow) => [r.label, num(r.englishOnly), num(r.both), num(r.mathOnly), num(r.englishOnly + r.both + r.mathOnly)];

/** 재원생 구성 표 둘 — 전체와 과목 탭이 같은 모양이다. */
export function compositionTables(levels: readonly SplitRow[], grades: readonly SplitRow[]): DetailTable[] {
  const shown = (r: SplitRow) => r.englishOnly + r.both + r.mathOnly > 0;
  return [
    { title: "학교급별 구성", unit: "명", cols: ["학교급", "영어만", "동시수강", "수학만", "합계"], rows: levels.filter(shown).map((r) => ({ cells: splitCells(r), level: r.label })) },
    { title: "학년별 구성", unit: "명", cols: ["학년", "영어만", "동시수강", "수학만", "합계"], rows: grades.filter(shown).map((r) => ({ cells: splitCells(r), level: levelOfSchoolGrade(r.label) })) },
  ];
}

/** 학교급 탭을 고르면 나오는 수치. */
export function levelStats(levels: readonly SplitRow[], name: string): Record<string, [string, string][]> {
  return Object.fromEntries(levels.map((r) => [r.label, [[name, `${num(r.englishOnly + r.both + r.mathOnly)}명`], ["영어만", `${num(r.englishOnly)}명`], ["동시수강", `${num(r.both)}명`], ["수학만", `${num(r.mathOnly)}명`]] as [string, string][]]));
}

export const programName = (program: Program, ctx: DetailContext) => programLabel(program, ctx.subjects, ctx.eieOn);

export function subjectName(key: string | null | undefined, ctx: DetailContext): string {
  if (!key) return "—";
  return ctx.snapshot.subjects[key] ?? key;
}

/** 달 키에 맞춰 값을 꺼낸다. 그 달 값이 없으면 빈칸(0으로 채우지 않는다). */
export const onMonths = (months: readonly string[], values: MonthValues) => months.map((m) => (m in values ? values[m]! : null));

type Line = { key: string; label: string };

/** 과목 탭을 눌렀을 때의 값 — 달마다 한 선 또는 두 선. 합계와 비중은 받은 값으로만 계산한다. */
export function subjectViews(
  lines: readonly Line[],
  months: readonly string[],
  series: (line: Line) => DetailSeries[] | null,
  base: Omit<DetailTrend, "labels" | "series">,
  stats: (line: Line, values: (number | null)[][]) => [string, string][],
  /** 그 과목의 표(달마다 값 등) — 수치·추세와 함께 바뀐다. */
  tables?: (line: Line, values: (number | null)[][]) => DetailTable[] | undefined,
) {
  const out: Record<string, DetailSlice> = {};
  for (const line of lines) {
    const list = series(line);
    if (!list) continue;
    const values = list.map((s) => s.values);
    const own = tables?.(line, values);
    out[line.label] = { stats: stats(line, values), trend: { ...base, labels: months.map(yyMm), series: list }, ...(own ? { tables: own } : {}) };
  }
  return out;
}

/** 과목을 한 그래프·한 표에 함께 놓는다. 값이 있는 과목이 둘 이상일 때만. */
export function compareSlice(
  lines: readonly Line[],
  months: readonly string[],
  valuesOf: (line: Line) => (number | null)[] | null,
  base: Omit<DetailTrend, "labels" | "series">,
): DetailSlice | undefined {
  const rows = lines.flatMap((l) => { const values = valuesOf(l); return values ? [{ l, values }] : []; });
  if (rows.length < 2) return undefined;
  const text = (n: number | null | undefined) => (n === null || n === undefined ? "—" : base.money ? moneyText(n) : `${n > 0 && base.lineOnly ? "+" : ""}${num(n)}${base.unit ?? ""}`);
  return {
    stats: rows.map(({ l, values }): [string, string] => [l.label, text(values.at(-1))]),
    trend: { kind: "line", ...base, labels: months.map(yyMm), series: rows.map(({ l, values }, i) => ({ name: l.label, values, ...subjectStyle(l.key, i) })) },
    tables: [monthTable(months, ["달", ...rows.map((r) => r.l.label)], (i) => rows.map((r) => text(r.values[i])))],
  };
}

/** 달마다 한 칸 표 — 최근 달이 위. */
export const monthTable = (months: readonly string[], cols: string[], cell: (i: number) => string[]): DetailTable => ({
  title: "달마다", cols, rows: months.map((m, i) => ({ cells: [yyMm(m), ...cell(i)] })).reverse(),
});

export const oneSeries = (name: string, values: (number | null)[], key = ""): DetailSeries => ({ name, values, tone: key ? subjectStyle(key).tone : "m-char" });

/** 오늘 값과 전체 대비 비중. */
export function shareStats(label: string, unit: string, now: number | null, total: number | null): [string, string][] {
  const value = now ?? 0;
  return [[`오늘 ${label}`, `${num(value)}${unit}`], ...(total ? [["전체 대비", `${Math.round((value / total) * 100)}%`] as [string, string]] : [])];
}
