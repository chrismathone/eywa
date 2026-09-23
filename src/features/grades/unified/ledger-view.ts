import { schoolGradeLabel, scorePercent, type UnifiedRow } from "./model";

/**
 * 성적 원장 열 머리의 **정렬·필터** — 순수 함수 한 벌(화면 머리의 선택지와 실제 거르기가 같은 판정을 쓴다).
 * 페이지를 자르기 **전에** 적용한다(한 페이지 안에서만 정렬하면 "오름차순"이 50건 안에서만 맞는다).
 */
export const LEDGER_SORTS = ["date", "name", "school", "class", "teacher", "kind", "score", "delta"] as const;
export type LedgerSort = (typeof LEDGER_SORTS)[number];
export type LedgerView = {
  sort: LedgerSort; dir: "asc" | "desc";
  school?: string; classId?: string; teacher?: string;
  score?: "high" | "mid" | "low"; delta?: "up" | "down" | "same"; consult?: "done" | "none";
};

export function parseLedgerView(raw: Record<string, string | undefined>): LedgerView {
  const sort = (LEDGER_SORTS as readonly string[]).includes(raw.sort ?? "") ? raw.sort as LedgerSort : "date";
  const dir = raw.dir === "asc" || raw.dir === "desc" ? raw.dir : sort === "date" || sort === "score" || sort === "delta" ? "desc" : "asc";
  const pick = <T extends string>(v: string | undefined, allowed: readonly T[]) => (allowed as readonly string[]).includes(v ?? "") ? v as T : undefined;
  return { sort, dir, school: raw.fSchool || undefined, classId: raw.fClass || undefined, teacher: raw.fTeacher || undefined,
    score: pick(raw.fScore, ["high", "mid", "low"] as const), delta: pick(raw.fDelta, ["up", "down", "same"] as const),
    consult: pick(raw.fConsult, ["done", "none"] as const) };
}

export const teachersOf = (row: UnifiedRow) => [...new Set(row.classes.map((c) => c.teacher).filter((t): t is string => !!t))];
export const schoolOf = (row: UnifiedRow) => schoolGradeLabel(row.school, row.grade);
const consulted = (row: UnifiedRow) => !!(row.consultationDate ?? row.manualConsultationDate);

function scoreBand(row: UnifiedRow): "high" | "mid" | "low" | null {
  const pct = scorePercent(row);
  if (pct == null) return null;
  return pct >= 90 ? "high" : pct >= 60 ? "mid" : "low";
}

function sortKey(row: UnifiedRow, sort: LedgerSort): string | number | null {
  switch (sort) {
    case "date": return row.date;
    case "name": return row.name;
    case "school": return schoolOf(row);
    case "class": return row.classes.map((c) => c.name).join(" / ") || null;
    case "teacher": return teachersOf(row).join(" / ") || null;
    case "kind": return row.kind;
    case "score": return scorePercent(row);
    case "delta": return row.delta;
  }
}

export function applyLedgerView(rows: readonly UnifiedRow[], view: LedgerView): UnifiedRow[] {
  const kept = rows.filter((row) =>
    (!view.school || schoolOf(row) === view.school) &&
    (!view.classId || row.classes.some((c) => c.id === view.classId)) &&
    (!view.teacher || teachersOf(row).includes(view.teacher)) &&
    (!view.score || scoreBand(row) === view.score) &&
    (!view.delta || (view.delta === "up" ? (row.delta ?? 0) > 0 : view.delta === "down" ? (row.delta ?? 0) < 0 : row.delta === 0)) &&
    (!view.consult || (view.consult === "done") === consulted(row)));
  const sign = view.dir === "asc" ? 1 : -1;
  // 값이 없는 행(점수 미입력·증감 없음)은 방향과 상관없이 **맨 뒤** — 내림차순에서 빈 칸이 맨 위로 오면 안 된다.
  return kept.map((row, i) => ({ row, i, key: sortKey(row, view.sort) })).sort((a, b) => {
    if (a.key == null || b.key == null) return a.key == null && b.key == null ? a.i - b.i : a.key == null ? 1 : -1;
    const cmp = typeof a.key === "number" && typeof b.key === "number" ? a.key - b.key : String(a.key).localeCompare(String(b.key), "ko");
    return cmp !== 0 ? cmp * sign : a.i - b.i;
  }).map((x) => x.row);
}

/** 열 머리 드롭다운 선택지 — 열 필터를 걸기 **전** 행에서 만든다(걸면 선택지가 사라져 되돌릴 수 없다). */
export function ledgerOptions(rows: readonly UnifiedRow[]) {
  const schools = new Set<string>();
  const classes = new Map<string, string>();
  const teachers = new Set<string>();
  for (const row of rows) {
    schools.add(schoolOf(row));
    for (const c of row.classes) classes.set(c.id, c.name);
    for (const t of teachersOf(row)) teachers.add(t);
  }
  const ko = (a: string, b: string) => a.localeCompare(b, "ko");
  return {
    schools: [...schools].sort(ko).map((s) => ({ value: s, label: s })),
    classes: [...classes].sort((a, b) => ko(a[1], b[1])).map(([value, label]) => ({ value, label })),
    teachers: [...teachers].sort(ko).map((t) => ({ value: t, label: t })),
  };
}
