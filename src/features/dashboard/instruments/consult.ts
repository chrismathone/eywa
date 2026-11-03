/** 학생 상담 카드·상세 — 목록 요약 띠·상담 통계와 같은 함수로 센다(같은 값이 화면마다 갈리지 않게). */
import { consultationStatsHref } from "@/features/dashboard/overview/kpi-links";
import type { StudentConsultationCounts } from "@/features/consultations/server/queries";
import { bucketLabel } from "@/features/consultations/stats-model";
import { changeText, homeroomRate, recentWeekTrend } from "@/features/consultations/stats-recent";
import { kstDateOf } from "@/lib/date-kst";
import { compareSlice, courseName, oneSeries, subjectTab } from "./details-shared";
import type { Detail, DetailContext, DetailTable } from "./details-types";
import type { HomeroomStudent } from "@/features/consultations/homeroom-model";
import type { ConsultExtras, ConsultHomeroom, ConsultPending } from "./extras-types";
import { monthDay, num, percent, yyMm } from "./labels";

export const CONSULT_NOTE = "이번 달 담임 상담 · 최근 12주 · 후속조치";
const PLAIN_NOTE = "최근 7일 · 전체 기록 · 후속조치";
export const consultNote = (consult: ConsultExtras | null) => (consult ? CONSULT_NOTE : PLAIN_NOTE);

const rateText = (rate: number | null) => (rate === null ? "—" : `${rate}%`);

export type ProgramKeyOf = (subject: string | null, track: string | null) => string | null;
export type ConsultRow = { consulted_at: string; subject: string | null; class_id: string | null };

/**
 * 상담을 달 × 과목으로 센다. 과목은 상담에 적힌 과목이 먼저고, 영어는 반의 프로그램 구분으로 가른다.
 * 반을 모르는 영어는 인재원 영어다(`programKeyOf` — 'EiE가 아닌 전부'). 과목도 반도 없는 상담은 전체에만 든다.
 */
export function consultSubjectMonths(rows: readonly ConsultRow[], months: readonly string[], classes: ReadonlyMap<string, { subject: string | null; english_track: string | null }>, keyOf: ProgramKeyOf) {
  const at = new Map(months.map((m, i) => [m, i]));
  const out: Record<string, number[]> = {};
  for (const row of rows) {
    const i = at.get(kstDateOf(row.consulted_at)?.slice(0, 7) ?? "");
    if (i === undefined) continue;
    const cls = row.class_id ? classes.get(row.class_id) : undefined;
    const key = keyOf(row.subject?.trim() || cls?.subject || null, cls?.english_track ?? null);
    if (!key) continue;
    (out[key] ??= months.map(() => 0))[i]! += 1;
  }
  return out;
}

/** 이번 달 담임 본인 상담이 없는 학생 — 그 달 반에 들어오기 전 학생은 대상이 아니다. */
export function pendingOf(students: readonly HomeroomStudent[]): ConsultPending[] {
  return students.flatMap((s) => {
    const last = s.cells.length - 1;
    const now = s.cells[last];
    if (now === undefined || now === "self" || now === "before") return [];
    return [{ id: s.id, name: s.name, grade: s.grade, prev: last > 0 ? s.cells[last - 1]! : null, last: s.lastSelf }];
  });
}

/** 지난달에 담임 상담이 없었고 이번 달도 아직인 학생 — 월초에도 '아직 안 한 학생 전부'로 부풀지 않는 신호다. */
export const missedTwice = (p: ConsultPending) => p.prev === "none" || p.prev === "other";

export function consultGaps(consult: ConsultExtras) {
  const rows = consult.homeroom?.rows ?? [];
  const twice = rows.filter((r) => r.pending.some(missedTwice));
  // 학생 수 — 수학 · 영어 담임이 둘 다 빠뜨린 학생도 한 명이다(담임별 합이 아니다).
  const students = new Set(twice.flatMap((r) => r.pending.filter(missedTwice).map((p) => p.id))).size;
  return { rate: rows.length ? homeroomRate(rows).now : null, prev: rows.length ? homeroomRate(rows).prev : null, twice: students, teachers: twice.length };
}

/** 카드의 값. 끝 칸은 진행 중인 이번 주다. */
export function consultBoard(consult: ConsultExtras, today: string) {
  const { weeks, homeroom } = consult;
  const recent = recentWeekTrend(weeks, today);
  return {
    rate: homeroom ? homeroomRate(homeroom.rows).now : null,
    recent: recent.recent,
    change: changeText(recent.changePct),
    labels: weeks.map((w, i) => (i === weeks.length - 1 ? "이번 주" : bucketLabel(w.b, "week"))),
    values: weeks.map((w) => w.n),
  };
}

const month = (ym: string) => `${Number(ym.slice(5))}월`;
const ratio = (counseled: number, target: number) => (target > 0 ? `${num(counseled)} / ${num(target)} (${percent(counseled, target)}%)` : "—");

/** 담임의 과목 탭 — 영어 반은 EiE · 인재원 영어로 갈린다(반 이름 → 과목). 반을 모르면 과목 키로. */
const teacherTabs = (row: ConsultHomeroom["rows"][number], ctx: DetailContext) => {
  const known = row.classNames.flatMap((name) => { const label = ctx.extras.roster?.classSubjects[name]; return label ? [label] : []; });
  return [...new Set(known.length ? known : row.subjects.map((key) => subjectTab(key, ctx)))];
};

/** 이번 달 상담률이 낮은 담임부터 — 챙길 사람이 위로(목록 요약 띠의 표와 같은 순서). */
function teacherTable(homeroom: ConsultHomeroom, ctx: DetailContext): DetailTable {
  const last = homeroom.months.length - 1;
  const rate = (row: ConsultHomeroom["rows"][number]) => { const m = row.months[last]!; return m.target > 0 ? m.counseled / m.target : 2; };
  return {
    title: "담임별 상담", unit: "명",
    cols: ["담임", "과목", ...homeroom.months.map((m, i) => (i === last ? `${month(m)}(진행 중)` : month(m))), "이번 달 건수"],
    rows: [...homeroom.rows].sort((a, b) => rate(a) - rate(b) || a.name.localeCompare(b.name, "ko")).map((row) => {
      const subject = teacherTabs(row, ctx);
      return {
        cells: [row.name, subject.join("·") || "—", ...row.months.map((m) => ratio(m.counseled, m.target)), `${num(row.months[last]!.count)}건`],
        href: `/consultations/stats?who=${encodeURIComponent(row.id)}#homeroom`, linkTitle: "상담 통계", subject,
      };
    }),
  };
}

const PREV_TEXT = { self: "상담함", other: "다른 직원만", none: "없음", before: "—" } as const;

/** 지난달부터 없는 학생 → 마지막 상담이 오래된 학생 순. 상담 이력이 없으면 맨 위. */
function pendingTable(homeroom: ConsultHomeroom, ctx: DetailContext): DetailTable {
  const rows = homeroom.rows.flatMap((row) => { const subject = teacherTabs(row, ctx); return row.pending.map((p) => ({ p, teacher: row.name, subject })); });
  const rank = (p: ConsultPending) => (missedTwice(p) ? 0 : 1);
  rows.sort((a, b) => rank(a.p) - rank(b.p) || (a.p.last ?? "").localeCompare(b.p.last ?? "") || a.p.name.localeCompare(b.p.name, "ko"));
  return {
    title: "이번 달 담임 상담 안 한 학생", unit: "명", cols: ["학생", "학년", "담임", "지난달", "마지막 상담"],
    rows: rows.map(({ p, teacher, subject }) => ({
      cells: [p.name, p.grade ?? "—", teacher, p.prev ? PREV_TEXT[p.prev] : "—", p.last ? monthDay(p.last) : "—"],
      ...(ctx.can("students") ? { href: `/students/${p.id}`, linkTitle: p.name } : {}), subject,
    })),
  };
}

const TAB_NOTE = "반을 알 수 없는 영어 상담은 인재원 영어로 셉니다. 과목이 없는 상담은 전체에만 듭니다.";

/** 과목 탭의 달별 상담과 '비교'. 달 칸은 전체 추세와 같다. */
function subjectSlices(consult: ConsultExtras, months: readonly string[], skip: number, ctx: DetailContext) {
  // 최근 석 달에 상담이 없는 과목은 탭을 세우지 않는다(옛 과목 — 전체에는 그대로 든다).
  const lines = Object.entries(consult.bySubject ?? {}).filter(([, v]) => v.slice(-3).some((n) => n > 0)).map(([key, v]) => ({ key, label: courseName(key, ctx), values: v.slice(skip) })).sort((a, b) => a.label.localeCompare(b.label, "ko"));
  const base = { unit: "건", note: TAB_NOTE };
  return {
    tabs: Object.fromEntries(lines.map(({ key, label, values }) => [label, { title: "달별 상담", labels: months.map(yyMm), series: [oneSeries("상담", values, key)], kind: "bar" as const, ...base }])),
    compare: compareSlice(lines, months, (l) => lines.find((x) => x.key === l.key)!.values, { title: "과목별 상담", ...base }),
  };
}

/** 🔴 과목 탭 — 담임 표·담임 상담률과 달별 상담을 함께 바꾼다. 분류별 표는 과목으로 못 가르면 숨는다(`drawerView` — 줄이 없는 표는 남는다). */
export function consultDetail(c: StudentConsultationCounts, ctx: DetailContext): Detail {
  const consult = ctx.extras.consult;
  const board = consult ? consultBoard(consult, ctx.snapshot.today) : null;
  const homeroom = consult?.homeroom ?? null;
  const table = homeroom ? teacherTable(homeroom, ctx) : null;
  const gaps = consult ? consultGaps(consult) : null;
  const total = consult?.categories.reduce((a, b) => a + b.recent, 0) ?? 0;
  // 첫 기록 앞의 달은 0건이 아니라 기록이 없던 달이다 — 그리지 않는다.
  const skip = consult ? Math.max(0, consult.months.findIndex((m) => m.n > 0)) : 0;
  const months = consult?.months.slice(skip) ?? [];
  const slices = consult ? subjectSlices(consult, months.map((m) => m.b.slice(0, 7)), skip, ctx) : null;
  const tabs = [...new Set([...Object.keys(slices?.tabs ?? {}), ...(table?.rows.flatMap((r) => r.subject ?? []) ?? [])])];
  const homeroomStats = (tab: string): [string, string][] => {
    if (!homeroom) return [];
    const rows = homeroom.rows.filter((row) => teacherTabs(row, ctx).includes(tab));
    return [["담임 상담 이번 달", rateText(homeroomRate(rows).now)], ["담임", `${num(rows.length)}명`]];
  };
  return {
    title: "학생 상담", period: consultNote(consult),
    stats: [
      ...(board ? [["담임 상담 이번 달", rateText(board.rate)], ...(gaps?.prev == null ? [] : [["지난달 담임 상담", rateText(gaps.prev)]]), ...(gaps?.twice ? [["지난달부터 없음", `${num(gaps.twice)}명`]] : []), [`최근 4주${board.change ? ` ${board.change}` : ""}`, `${num(board.recent)}건`]] as [string, string][] : []),
      ["최근 7일", `${num(c.lastWeek)}건`], ["이번 달", `${num(c.thisMonth)}건`], ["기한 경과", `${num(c.overdueFollowUps)}건`], ["기한 예정", `${num(c.pendingFollowUps - c.overdueFollowUps)}건`],
    ],
    ...(months.length ? { trend: { title: "달별 상담", labels: months.map((m) => yyMm(m.b.slice(0, 7))), series: [oneSeries("상담", months.map((m) => m.n))], unit: "건", kind: "bar" as const } } : {}),
    ...(tabs.length > 1 ? { bySubject: Object.fromEntries(tabs.map((tab) => {
      const trend = slices?.tabs[tab];
      return [tab, { stats: [...homeroomStats(tab), ...(trend ? [["이번 달 상담", `${num(trend.series[0]!.values.at(-1) ?? 0)}건`]] as [string, string][] : [])], ...(trend ? { trend } : {}) }];
    })) } : {}),
    ...(slices?.compare ? { compare: slices.compare } : {}),
    tables: [
      ...(table ? [table] : []),
      ...(homeroom?.rows.some((r) => r.pending.length) ? [pendingTable(homeroom, ctx)] : []),
      ...(consult?.categories.length ? [{ title: "분류별 · 최근 12주", cols: ["분류", "상담", "비중"], rows: consult.categories.map((row) => ({ cells: [row.label, `${num(row.recent)}건`, `${percent(row.recent, total)}%`] })) }] : []),
    ],
    link: { href: consultationStatsHref(), label: "상담 통계에서 보기" },
  };
}
