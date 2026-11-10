import { schoolGradeLabel } from "@/lib/format/school-grade";
import { add, cellOf, earlyDoneOf, EMPTY, MATRIX_COLUMNS, MIN_JUDGE, upcomingOf, type AttentionRow, type Cell, type ClassInfo, type OwnerInfo, type RollupClass, type RollupOwnerKind, type RollupStudent, type StudentInfo } from "./view-admin";

/**
 * 단계별 보기(과목 → 선생님 → 반 → 학생)의 순수 조립 — 원장 2026-11-10 *"과목별 - 선생님별 - 반별 - 학생별로 디테일 될 수 있게 … 이 선생님이 뭘 안했는지,
 * 뭘 체크해야하는지"* · *"잘하고 있다 못하고 있다도 판단할 수 있어야함"*. 판정 기준은 `judge` 한 곳.
 */

/**
 * 잘하고 있나 — **기한이 온 의무 중 제때 끝낸 비율**(90/70 경계). 기한 전 의무(말일이 기한인 월 상담 · 아직 수업 전인 오늘)는 판정에 안 든다 —
 * 그것까지 세면 달 초·수업 전에 전원 '미흡'이 된다(원장 계정 화면 2026-11-10 — 14명 전원 미흡). 기한 온 것이 3건 미만이면 등급 없이 '평가 대기'.
 * 🔴 지연이 오래됐다는 이유로 등급을 덮어쓰지 않는다 — 준수율(실적)과 지금 손댈 것(지연 수)은 다른 숫자다. 근거 한 줄은 숫자로.
 */
export type Verdict = { grade: "good" | "warn" | "bad" | "wait" | "none"; label: string; reason: string };
export const VERDICT_LABEL: Record<Verdict["grade"], string> = { good: "잘하고 있음", warn: "주의", bad: "미흡", wait: "평가 대기", none: "의무 없음" };
export type Avg = { pct: number | null; label: string };
export function judge(cell: Cell, avg: Avg | null = null): Verdict {
  if (!cell.total) return { grade: "none", label: VERDICT_LABEL.none, reason: "" };
  const up = upcomingOf(cell);
  const parts: string[] = [];
  if (cell.due) parts.push(`제때 ${cell.ontime}/${cell.due}${cell.pct === null ? "" : `(${cell.pct}%)`}`);
  if (cell.late) parts.push(`지연 ${cell.late}`);
  if (cell.lateDone) parts.push(`늦게 끝냄 ${cell.lateDone}`);
  if (cell.expired) parts.push(`미이행 확정 ${cell.expired}`);
  if (up) parts.push(`기한 전 ${up}`);
  const early = earlyDoneOf(cell); if (early) parts.push(`미리 끝냄 ${early}`);
  if (cell.pct === null || cell.due < MIN_JUDGE) return { grade: "wait", label: VERDICT_LABEL.wait, reason: parts.join(" · ") };
  const grade: Verdict["grade"] = cell.pct >= 90 ? "good" : cell.pct >= 70 ? "warn" : "bad";
  if (avg && avg.pct !== null && cell.pct !== avg.pct) parts.push(`${avg.label} ${avg.pct}%보다 ${cell.pct > avg.pct ? "높음" : "낮음"}`);
  return { grade, label: VERDICT_LABEL[grade], reason: parts.join(" · ") };
}

export type TreeClass = { classId: string; name: string; cell: Cell };
export type TreeOwner = { ownerId: string; name: string; cell: Cell; cells: Record<string, Cell>; classes: TreeClass[] };
export type TreeSubject = { subject: string | null; label: string; cell: Cell; cells: Record<string, Cell>; owners: TreeOwner[] };
/** 손댈 것이 많은 순 — 지금 지연 → 기한 준수율 낮은 순(평가 대기는 뒤) → 이름. */
const byBad = (a: { cell: Cell; name: string }, b: { cell: Cell; name: string }) => b.cell.late - a.cell.late || (a.cell.pct ?? 101) - (b.cell.pct ?? 101) || a.name.localeCompare(b.name, "ko");

/** 반 없는 의무(신규생 정착 — 반과 무관한 학생 단위 의무)의 반 열쇠 — 트리·반 단계에서 한 줄로 묶는다. */
export const NO_CLASS = "none";
/** 그 줄의 이름 — '반 없음'이라고 쓰면 반 배정이 빠진 것으로 읽힌다(Codex 2026-11-10). */
export const NO_CLASS_LABEL = "신규생 정착 · 반 공통";
/** 과목 없는 의무('과목 미정')를 학생 집계 GET에 알리는 과목 값 — 서버가 `subject is null`로 읽는다. */
export const NO_SUBJECT = "none";
/** 담당자 없는 의무('담당 미정')의 담당 열쇠 — 학생 집계 GET엔 `owner=none`(서버가 `owner_id is null`로 읽는다). */
export const NO_OWNER = "";
const classNameOf = (id: string | null, classes: ClassInfo) => (id && id !== NO_CLASS ? classes[id]?.name ?? "반 이름 없음" : NO_CLASS_LABEL);

/** 왼쪽 트리 = 과목 → 선생님 → 반. 과목 없는 집계는 '과목 미정' · 학원 설정에 없는 과목 키는 '기타 과목'(같은 이름 줄이 둘 서지 않게). */
export function buildTree(ok: readonly RollupOwnerKind[], cls: readonly RollupClass[], owners: OwnerInfo, classes: ClassInfo, labels: Record<string, string>): TreeSubject[] {
  const subjects = new Map<string, TreeSubject>();
  const subjectOf = (key: string | null): TreeSubject => {
    const k = key ?? "";
    let s = subjects.get(k);
    if (!s) { s = { subject: key, label: key ? labels[key] ?? "기타 과목" : "과목 미정", cell: EMPTY, cells: {}, owners: [] }; subjects.set(k, s); }
    return s;
  };
  const ownerOf = (s: TreeSubject, id: string | null): TreeOwner => {
    const key = id ?? NO_OWNER;
    let o = s.owners.find((x) => x.ownerId === key);
    if (!o) { o = { ownerId: key, name: id ? owners[id] ?? "이름 없음" : "담당 미정", cell: EMPTY, cells: {}, classes: [] }; s.owners.push(o); }
    return o;
  };
  for (const r of ok) {
    const s = subjectOf(r.subject); const o = ownerOf(s, r.ownerId);
    o.cells[r.kind] = cellOf(add(o.cells[r.kind] ?? EMPTY, r)); o.cell = cellOf(add(o.cell, r));
    s.cells[r.kind] = cellOf(add(s.cells[r.kind] ?? EMPTY, r)); s.cell = cellOf(add(s.cell, r));
  }
  for (const r of cls) {
    const o = ownerOf(subjectOf(r.subject), r.ownerId);
    const id = r.classId ?? NO_CLASS;
    let c = o.classes.find((x) => x.classId === id);
    if (!c) { c = { classId: id, name: classNameOf(r.classId, classes), cell: EMPTY }; o.classes.push(c); }
    c.cell = cellOf(add(c.cell, r));
  }
  return [...subjects.values()].map((s) => ({ ...s, owners: s.owners.map((o) => ({ ...o, classes: o.classes.sort(byBad) })).sort(byBad) }))
    .sort((a, b) => (a.subject === null ? 1 : 0) - (b.subject === null ? 1 : 0) || a.label.localeCompare(b.label, "ko"));
}

/** 전 과목을 한 줄로 접은 뿌리(과목이 둘 이상일 때의 첫 화면) — 같은 선생님이 두 과목에 있으면 합친다. */
export function rootOfTree(tree: readonly TreeSubject[]): TreeSubject {
  const root: TreeSubject = { subject: null, label: "전체", cell: EMPTY, cells: {}, owners: [] };
  for (const s of tree) {
    root.cell = cellOf(add(root.cell, s.cell));
    for (const k of Object.keys(s.cells)) root.cells[k] = cellOf(add(root.cells[k] ?? EMPTY, s.cells[k]!));
    for (const o of s.owners) {
      let r = root.owners.find((x) => x.ownerId === o.ownerId);
      if (!r) { r = { ...o, cells: { ...o.cells }, classes: o.classes.map((c) => ({ ...c })) }; root.owners.push(r); continue; }
      r.cell = cellOf(add(r.cell, o.cell));
      for (const k of Object.keys(o.cells)) r.cells[k] = cellOf(add(r.cells[k] ?? EMPTY, o.cells[k]!));
      for (const c of o.classes) { const x = r.classes.find((y) => y.classId === c.classId); if (x) x.cell = cellOf(add(x.cell, c.cell)); else r.classes.push({ ...c }); }
    }
  }
  for (const o of root.owners) o.classes.sort(byBad);
  root.owners.sort(byBad);
  return root;
}

export type KindStatus = { kind: string; label: string; cell: Cell; upcoming: number };
/** 종류별 상태 줄 — 제때 · 지금 지연 · 늦게 끝냄 · 미이행 · 기한 전. 의무가 있는 종류만, 매트릭스 열 순서. */
export function kindStatuses(cells: Record<string, Cell>): KindStatus[] {
  return MATRIX_COLUMNS.flatMap((c) => { const cell = cells[c.kind]; return cell && cell.total ? [{ kind: c.kind, label: c.label, cell, upcoming: upcomingOf(cell) }] : []; });
}

/** 학생 집계 → 종류별 칸(합계). 학생 한 명(반 하나)이나 반 전체에 쓴다. */
export function sumCells(rows: readonly RollupStudent[], pick: (r: RollupStudent) => boolean): { cells: Record<string, Cell>; all: Cell } {
  const cells: Record<string, Cell> = {}; let all = EMPTY;
  for (const r of rows) {
    if (!pick(r)) continue;
    cells[r.kind] = cellOf(add(cells[r.kind] ?? EMPTY, r)); all = cellOf(add(all, r));
  }
  return { cells, all };
}
/** 반 열쇠가 같은가 — 반 없는 의무(null)는 NO_CLASS. 반 단계의 합·학생 줄이 **같은 비교**를 쓴다(한쪽만 ""로 비교해 합이 비던 결함 · 리뷰 2026-11-10). */
export const inClassOf = (classId: string) => (r: { classId: string | null }) => (r.classId ?? NO_CLASS) === classId;

export type StudentLine = { studentId: string; name: string; sub: string; cells: Record<string, Cell>; all: Cell };
/** 반 안의 학생 줄 — 지연 있는 학생 → 준수율 낮은 학생 순. classId가 NO_CLASS면 반 없는 의무(신규생 정착)의 학생들. */
export function studentLines(rows: readonly RollupStudent[], students: StudentInfo, classId: string): StudentLine[] {
  const inClass = inClassOf(classId);
  const ids = [...new Set(rows.filter((r) => inClass(r) && r.studentId).map((r) => r.studentId!))];
  return ids.map((id) => { const st = students[id]; const { cells, all } = sumCells(rows, (r) => inClass(r) && r.studentId === id);
    return { studentId: id, name: st?.name ?? "학생", sub: st ? schoolGradeLabel(st.school, st.grade) : "", cells, all }; })
    .sort((a, b) => b.all.late - a.all.late || (a.all.pct ?? 101) - (b.all.pct ?? 101) || a.name.localeCompare(b.name, "ko"));
}

export type ClassLine = { classId: string; name: string; cells: Record<string, Cell>; all: Cell; students: number };
/** 선생님 단계의 반 × 종류 줄(학생 집계에서) — 원장 2026-11-10 *"쭉 나열하는거 금지"*: 학생 이름 대신 반마다 한 줄, 이름은 반 단계에서. */
export function classLines(rows: readonly RollupStudent[], classes: ClassInfo): ClassLine[] {
  const ids = [...new Set(rows.map((r) => r.classId ?? NO_CLASS))];
  return ids.map((id) => { const inClass = inClassOf(id); const { cells, all } = sumCells(rows, inClass);
    return { classId: id, name: classNameOf(id, classes), cells, all, students: new Set(rows.filter((r) => inClass(r) && r.studentId).map((r) => r.studentId)).size }; })
    .sort((a, b) => b.all.late - a.all.late || (a.all.pct ?? 101) - (b.all.pct ?? 101) || a.name.localeCompare(b.name, "ko"));
}

/** '지금 지연'을 선생님(과목 단계)·반(선생님 단계) 단위로 접는다 — 이름 나열 금지(원장 2026-11-10). 접힌 줄 = 몇 명 · 종류별 지연 수 · 가장 오래된 날 수. */
export function foldAttention(rows: readonly AttentionRow[], by: "owner" | "class"): AttentionRow[] {
  const groups = new Map<string, AttentionRow & { kinds: Map<string, number>; ids: Set<string> }>();
  for (const r of rows) {
    const id = by === "owner" ? r.ownerId ?? NO_OWNER : r.classId ?? NO_CLASS;
    const name = by === "owner" ? (r.teacher || "담당 미정") : (r.className || NO_CLASS_LABEL);
    const g = groups.get(id) ?? { key: `${by}:${id}`, studentId: null, classId: by === "class" ? id : null, title: name, sub: "", ownerId: by === "owner" ? r.ownerId : r.ownerId, teacher: by === "class" ? r.teacher : "", className: by === "owner" ? "" : name,
      count: 0, summary: "", days: 0, oldest: r.oldest, students: 0, kinds: new Map(), ids: new Set() };
    g.count += r.count; g.days = Math.max(g.days, r.days); if (r.oldest < g.oldest) g.oldest = r.oldest;
    if (r.studentId) g.ids.add(r.studentId);
    for (const part of r.summary.split(" · ")) { const m = /^(.*) (\d+)$/.exec(part); if (m) g.kinds.set(m[1]!, (g.kinds.get(m[1]!) ?? 0) + Number(m[2])); }
    groups.set(id, g);
  }
  return [...groups.values()].map(({ kinds, ids, ...g }) => ({ ...g, students: ids.size, sub: ids.size ? `${ids.size}명` : "", summary: [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ") }))
    .sort((a, b) => b.days - a.days || b.count - a.count || a.title.localeCompare(b.title, "ko"));
}
