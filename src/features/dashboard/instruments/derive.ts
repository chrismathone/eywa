/**
 * 운영실 스냅샷 → '대시보드 전환' 카드가 그리는 값. 판정은 새로 만들지 않고 운영실 카드가 쓰는 값을 그림 모양으로만 바꾼다.
 * 순수 모듈 — 서버 조회 없음.
 */
import type { CareSummary, OverviewData } from "@/features/dashboard/overview/model";
import { monthKeys } from "@/features/dashboard/overview/model";
import { STAFF_SUBJECT_LEGEND } from "@/features/dashboard/overview/subject-colors";
import { admissionsListKind } from "@/features/dashboard/overview/display";
import { studentLevelOf, levelLabel } from "@/features/students/list-filter-values";
import { earlyCounts } from "@/features/withdrawals/early-exit";
import { hhmm, percent } from "./labels";

type Student = OverviewData["students"];

export const noEnrollmentOf = (s: Student) => s.academy?.noEnrollment ?? s.programs.noEnrollment;

/** 재원생 구성 — 운영실 `LevelSplitChart`와 같은 합계(학교급 막대 + 기타 과목 + 미수강). */
export function composition(s: Student) {
  const split = s.levelSplit?.rows ?? [];
  const noEnrollment = noEnrollmentOf(s);
  const otherOnly = Math.max(0, split.reduce((n, r) => n + r.neither, 0) - noEnrollment);
  const parts = (r: (typeof split)[number]) => [r.englishOnly, r.both, r.mathOnly];
  const rows: [string, number[]][] = [
    ...split.map((r): [string, number[]] => [r.label, [...parts(r), 0, 0]]),
    ...(otherOnly > 0 ? [["기타 과목", [0, 0, 0, otherOnly, 0]] as [string, number[]]] : []),
    ["미수강", [0, 0, 0, 0, noEnrollment]],
  ];
  const total = split.reduce((n, r) => n + r.englishOnly + r.both + r.mathOnly, 0) + otherOnly + noEnrollment;
  return { rows, total, otherOnly, noEnrollment };
}

/** 신규생 단계 — '90일 초과'는 값이 있을 때만(운영실과 같은 거르기). */
export function careStages(care: CareSummary) {
  return care.stages
    .filter((r) => r.value > 0 || r.label !== "90일 초과")
    .map((r): [string, number[]] => [r.label, [r.subjects?.englishOnly ?? 0, r.subjects?.both ?? 0, r.subjects?.mathOnly ?? 0, (r.subjects?.otherOnly ?? 0) + (r.subjects?.noEnrollment ?? 0)]]);
}

export function careDue(care: CareSummary) {
  const required = care.items.filter((r) => !r.optional);
  return { overdue: required.reduce((n, r) => n + r.overdue, 0), due: required.reduce((n, r) => n + r.due, 0), people: new Set(required.flatMap((r) => r.needs.map((p) => p.id))).size };
}

/** 학년별 재원생 — 값이 있는 학년만, 연속한 학교급을 묶어 아래 띠를 만든다. */
export function gradeColumns(s: Student) {
  const rows = s.gradeSplit.rows.filter((r) => r.englishOnly + r.both + r.mathOnly > 0);
  const groups: [string, number, number][] = [];
  for (const r of rows) {
    const label = levelLabel(studentLevelOf(r.label));
    const total = r.englishOnly + r.both + r.mathOnly;
    const last = groups[groups.length - 1];
    if (last && last[0] === label) { last[1] += 1; last[2] += total; } else groups.push([label, 1, total]);
  }
  return { rows: rows.map((r): [string, number[]] => [r.label, [r.englishOnly, r.both, r.mathOnly]]), groups };
}

/** 학교별 — 학교급마다 큰 학교 다섯 + 나머지. */
export function schoolGroups(s: Student) {
  return (s.schoolGroups ?? []).filter((g) => g.total > 0).map((g) => {
    const list = g.schools.map((x): [string, number] => [x.label, x.value]);
    return { label: g.label, total: g.total, schools: list.slice(0, 5), rest: list.slice(5) };
  });
}

/** 콜&상담 전환 — 달력 키로 고른다(운영실 `AdmissionsComparison`과 같다). */
export function admissionMonths(stats: OverviewData["admissions"], today: string) {
  return monthKeys(today, 2).map((key, i) => {
    const d = [...stats.months, ...stats.prevYearMonths].find((row) => row.month === key);
    return {
      key, tag: i === 0 ? "지난달" : "이번 달",
      total: d?.total ?? null,
      rate: d && d.total > 0 ? `${((d.enrolled / d.total) * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%` : "—",
      parts: d ? ([["등록", d.enrolled], ["진행", d.open], ["미등록", d.declined], ["미방문", d.noShow]] as [string, number][]) : null,
    };
  });
}

/** 달마다 3개월 내 퇴원 — 이번 달은 스냅샷 행, 지난 달은 이력으로 센다(운영실 카드와 같은 판정). */
export function earlyMonthly(data: OverviewData["earlyExits"]) {
  return data.months.map((month) => ({ month, count: earlyCounts(month === data.month ? data.rows : data.history.filter((h) => h.month === month))["3m"] }));
}

export function repeatRows(rows: OverviewData["absences"]["rows"]): [string, number][] {
  const n = (t: (u: number) => boolean) => rows.filter((r) => t(r.unexplained)).length;
  return [["3회", n((u) => u === 3)], ["4회", n((u) => u === 4)], ["5회 이상", n((u) => u >= 5)]];
}

/** 14일 등원율 — 날마다의 비율을 기록 칸 수로 가중 평균한다. 기록이 없는 날은 빈칸. */
export function attendance14(points: OverviewData["attendanceTrend"]) {
  const days = points.map((p): [string, number | null] => [p.date, p.rate === null ? null : Math.round(p.rate)]);
  const valid = points.reduce((n, p) => n + (p.rate === null ? 0 : p.total), 0);
  const attended = points.reduce((n, p) => n + (p.rate === null ? 0 : (p.rate / 100) * p.total), 0);
  return { days, valid, attended: Math.round(attended), value: percent(attended, valid) };
}

export const consultSteps = (counts: OverviewData["consultProgress"]["summary"]["counts"]) =>
  ([["접수", counts.received], ["상담", counts.consulted], ["입테", counts.levelTest], ["등록", counts.enrolled], ["반 배정", counts.assigned], ["수업 시작", counts.started]] as [string, number | null][])
    .filter((s): s is [string, number] => s[1] !== null);

/** 현재 수업 — 진행 중인 반만 그린다. 없으면 곧 시작할 반을 보여 준다. 테스트 반은 부르는 쪽에서 뺀다. */
export const TIMELINE_ROWS = 6;
export function timeline(schedule: OverviewData["schedule"], clock: string, nameOf: (slot: OverviewData["schedule"][number]) => { key: string; label: string }) {
  const byStart = (a: { startTime: string }, b: { startTime: string }) => a.startTime.localeCompare(b.startTime);
  const running = schedule.filter((s) => s.status === "ongoing").sort(byStart);
  const next = schedule.filter((s) => s.status === "upcoming").sort(byStart).slice(0, TIMELINE_ROWS);
  const shown = running.length ? running : next;
  const hours = shown.flatMap((s) => [Number(s.startTime.slice(0, 2)), Number(s.endTime.slice(0, 2)) + 1]);
  const from = Math.min(...hours, Number(clock.slice(0, 2)));
  const to = Math.max(...hours, from + 2);
  const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return {
    running: running.length, from: pad(from), to: pad(to), now: clock,
    rows: shown.map((s) => { const n = nameOf(s); return { subject: n.label, key: n.key, name: s.className, room: s.classroomName ?? "교실 미정", start: hhmm(s.startTime), end: hhmm(s.endTime) }; }),
  };
}

/** 한 달 일정을 7일씩 묶는다. 날짜 표식은 붙은 날끼리 겹쳐 숫자를 읽을 수 없다. 취소는 숫자에서 뺀다. */
export function scheduleWeeks(rows: readonly OverviewData["calendar"][number][], today: string) {
  const start = Date.parse(`${today}T00:00:00Z`);
  const week = (d: string) => Math.min(4, Math.max(0, Math.floor((Date.parse(`${d}T00:00:00Z`) - start) / (7 * 86_400_000))));
  const count = (kind: "levelTest" | "firstClass") => { const out = [0, 0, 0, 0, 0]; for (const r of rows) if (r.kind === kind) out[week(r.startDate)]! += 1; return out; };
  const tests = count("levelTest");
  const firsts = count("firstClass");
  const size = tests[4] || firsts[4] ? 5 : 4;
  const label = (i: number) => { const d = new Date(start + i * 7 * 86_400_000).toISOString().slice(0, 10); return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}~`; };
  return {
    labels: Array.from({ length: size }, (_, i) => label(i)),
    tests: tests.slice(0, size), firsts: firsts.slice(0, size),
    total: tests.reduce((n, v) => n + v, 0) + firsts.reduce((n, v) => n + v, 0),
    cancelled: rows.filter((r) => r.kind === null && admissionsListKind(r)).length,
  };
}

export function staffRows(staff: OverviewData["staff"]) {
  const groups = STAFF_SUBJECT_LEGEND.filter((g) => staff.some((row) => row.bySubject[g.key] > 0));
  return { series: groups.map((g) => g.label), rows: staff.map((row): [string, number[]] => [row.label, groups.map((g) => row.bySubject[g.key])]), total: staff.reduce((n, r) => n + r.value, 0) };
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
export const weekdayOf = (date: string) => WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()]!;

/** 최근 결석 — 날마다 빠진 수업 수(카드 숫자와 같은 줄을 날짜로만 나눈다). */
export function absentDaily(data: OverviewData["absent"]) {
  const days: string[] = [];
  for (let t = Date.parse(`${data.from}T00:00:00Z`), end = Date.parse(`${data.to}T00:00:00Z`); t <= end; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  const counts = new Map<string, number>();
  for (const s of data.students) for (const a of s.absences) counts.set(a.date, (counts.get(a.date) ?? 0) + 1);
  return { labels: days.map(weekdayOf), values: days.map((d) => counts.get(d) ?? 0), days };
}

/** 보강 예약 — 오늘부터 7일씩 나눈다. 지난 미이행은 첫 칸에 든다. */
export function makeupWeekly(rows: OverviewData["makeup"]["rows"], today: string) {
  const start = Date.parse(`${today}T00:00:00Z`);
  const values = [0, 0, 0, 0, 0];
  for (const r of rows) values[Math.min(4, Math.max(0, Math.floor((Date.parse(`${r.makeupDate}T00:00:00Z`) - start) / (7 * 86_400_000))))]! += 1;
  const size = values[4] ? 5 : 4;
  return { labels: ["이번 주", "2주", "3주", "4주", "5주"].slice(0, size), values: values.slice(0, size) };
}

/** 이달 신규 등록일 — 작은 계단 그래프 재료(날짜 순). */
export function newDates(rows: readonly { date: string | null }[]) {
  return rows.flatMap((r) => (r.date ? [r.date] : [])).sort().map((d) => `${d.slice(5, 7)}/${d.slice(8, 10)}`);
}

export const daysInMonth = (today: string) => new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
