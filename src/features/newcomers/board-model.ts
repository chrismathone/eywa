import { schoolGradeLabel } from "@/lib/format/school-grade";
import { careCellMatches, parseCareCellParam } from "./care-cells";
import { NEWCOMER_BUCKETS, ONBOARDING_ITEMS, daysLeftOf, dueDateOf, progressOf, statusOf, type NewcomerBucket, type OnboardingItemDef, type OnboardingItemStatus } from "./onboarding-items";
import type { NewcomerRow } from "./server/queries";

export type BoardStatus = "all" | "open" | "overdue" | "due";
export type BoardSort = "recent" | "name" | "firstClass" | "priority";
export type BoardFilters = { bucket: NewcomerBucket | null; status: BoardStatus; item: string | null; query: string; subject: string; sort: BoardSort };
export const EMPTY_FILTERS: BoardFilters = { bucket: null, status: "all", item: null, query: "", subject: "all", sort: "recent" };

export function parseBoardFilters(params: { get: (key: string) => string | null }): BoardFilters {
  const bucket = params.get("bucket"), status = params.get("status"), sort = params.get("sort");
  return {
    bucket: NEWCOMER_BUCKETS.includes(bucket as NewcomerBucket) ? bucket as NewcomerBucket : null,
    status: status === "overdue" || status === "due" || status === "open" ? status : params.get("only") === "open" ? "open" : "all",
    item: parseCareCellParam(params.get("item") ?? undefined)?.key ?? null,
    query: params.get("q") ?? "", subject: params.get("subject") || "all",
    sort: sort === "name" || sort === "firstClass" || sort === "priority" ? sort : "recent",
  };
}

/** 기존 only=open/item 링크와 embed 등 화면 밖의 URL 값도 보존한다. */
export function boardSearchParams(filters: BoardFilters, current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of ["bucket", "status", "only", "item", "q", "subject", "sort"]) next.delete(key);
  if (filters.bucket) next.set("bucket", filters.bucket);
  if (filters.status === "open") next.set("only", "open");
  else if (filters.status !== "all") next.set("status", filters.status);
  if (filters.item) next.set("item", filters.item);
  if (filters.query) next.set("q", filters.query);
  if (filters.subject !== "all") next.set("subject", filters.subject);
  if (filters.sort !== "recent") next.set("sort", filters.sort);
  return next;
}

export const studentsIn = (rows: readonly NewcomerRow[]) => new Set(rows.map((row) => row.studentId)).size;

/** 기존 집계 단위: 명은 학생 ID, 건은 학생×과목별 필수 업무. */
export function boardStats(rows: readonly NewcomerRow[], today: string) {
  let overdue = 0, dueSoon = 0, doneCount = 0, dueTotal = 0, waived = 0;
  const open = new Set<string>();
  for (const row of rows) {
    const progress = progressOf(row, row.checks, today);
    overdue += progress.overdue; dueSoon += progress.dueSoon;
    doneCount += progress.doneCount; dueTotal += progress.dueTotal;
    if (progress.overdue + progress.dueSoon > 0) open.add(row.studentId);
    waived += ONBOARDING_ITEMS.filter((item) => !item.optional && statusOf(item, row, row.checks[item.key], today) === "waived").length;
  }
  return { students: studentsIn(rows), rows: rows.length, openStudents: open.size, overdue, dueSoon, doneCount, dueTotal, waived, rate: dueTotal === 0 ? 100 : Math.round(doneCount / dueTotal * 100) };
}

export type PriorityTask = { key: string; rowKey: string; row: NewcomerRow; item: OnboardingItemDef; status: OnboardingItemStatus; due: string; daysLeft: number };

/** 지연 → 오늘 → 임박, 같은 기한이면 기존 학생·과목 순서. 선택 업무는 집계와 동일하게 제외한다. */
export function priorityTasks(rows: readonly NewcomerRow[], today: string): PriorityTask[] {
  return rows.flatMap((row) => ONBOARDING_ITEMS.filter((item) => !item.optional).flatMap((item) => {
    const status = statusOf(item, row, row.checks[item.key], today);
    if (status !== "overdue" && status !== "due") return [];
    return [{ key: `${row.rowKey}|${item.key}`, rowKey: row.rowKey, row, item, status, due: dueDateOf(item, row)!, daysLeft: daysLeftOf(item, row, today)! }];
  })).sort((a, b) => a.due.localeCompare(b.due));
}

export function matchesBoardStatus(row: NewcomerRow, status: BoardStatus): boolean {
  if (status === "overdue") return row.progress.overdue > 0;
  if (status === "due") return row.progress.dueSoon > 0;
  return status !== "open" || row.progress.overdue + row.progress.dueSoon > 0;
}

export function filterBoardRows(rows: readonly NewcomerRow[], filters: BoardFilters, today: string, subjectLabel: (key: string) => string): NewcomerRow[] {
  const item = parseCareCellParam(filters.item ?? undefined);
  const normalize = (s: string) => s.normalize("NFKC").toLocaleLowerCase("ko").replace(/\s+/g, "");
  const query = filters.query.trim().split(/\s+/).map(normalize).filter(Boolean);
  const filtered = rows.filter((row) => (!filters.bucket || row.bucket === filters.bucket)
    && matchesBoardStatus(row, filters.status)
    && (!item || careCellMatches(item, row, today))
    && (filters.subject === "all" || (filters.subject === "none" ? row.subject === null : row.subject === filters.subject))
    && query.every(term => normalize([row.name, row.school, row.grade, schoolGradeLabel(row.school, row.grade), row.subject ? subjectLabel(row.subject) : "과목 미정"].join(" ")).includes(term)));
  if (filters.sort === "name") return filtered.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  if (filters.sort === "firstClass") return filtered.sort((a, b) => (a.firstClassOn ?? "9999").localeCompare(b.firstClassOn ?? "9999"));
  if (filters.sort === "priority") {
    const tasks = priorityTasks(rows, today);
    const position = new Map<string, number>();
    tasks.forEach((task, index) => { if (!position.has(task.rowKey)) position.set(task.rowKey, index); });
    return filtered.sort((a, b) => (position.get(a.rowKey) ?? Infinity) - (position.get(b.rowKey) ?? Infinity));
  }
  return filtered; // 서버의 등록일 내림차순·ID·과목 순서 보존.
}

export type CheckPatch = Record<string, string | null>;
export function withCheckPatches(rows: readonly NewcomerRow[], patches: CheckPatch, today: string): NewcomerRow[] {
  return rows.map((row) => {
    const checks = { ...row.checks };
    for (const item of ONBOARDING_ITEMS) {
      const key = `${row.rowKey}|${item.key}`;
      if (key in patches) checks[item.key] = patches[key] ?? null;
    }
    return { ...row, checks, progress: progressOf(row, checks, today) };
  });
}

export function shortDate(date: string): string { return `${date.slice(2, 4)}.${date.slice(5, 7)}.${date.slice(8, 10)}`; }
