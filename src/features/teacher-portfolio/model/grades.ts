/**
 * 성적 관리 — 그 달 담당 학생의 시험 기록(원장 결정 10 *"성적관리에 등록된 성적 기준"*). 순수 함수.
 *
 * 🔴 종류마다 재는 것이 다르다(원장 2026-10-15 *"일일테스트는 점수율이 아니라 제출율이 필요함 … 월말평가를 월 1회 시행하는가 하는 꾸준함"*):
 * - 일일테스트 = **제출률** — 이 선생님의 보고서 대상 칸(학생 · 수업일 — 결석·휴원·휴원일·보강으로 메운 날 제외, 보고서 작성률과 같은 칸
 *   `duties.ts` `reportTargets` · 앱 밖 과목·작성 면제 칸은 작성률처럼 없다) 중 그날 그 학생의 그 과목 일일테스트 기록이 있는 칸의 비율.
 *   점수는 보지 않는다. 누가 입력했는지도 묻지 않는다.
 * - 월말평가 = **응시율** — 그 달 마지막 날(진행 중인 달은 집계 끝 날 = 어제) 이 선생님 담임 반의 명단(원생상담과 같은 명단 `rosterOf` — 휴원·보강 묶음 제외)
 *   학생 중 그 달 그 과목 월말평가 기록이 있는 학생의 비율(학생 · 과목마다 한 번). 안 봤으면 0%. 달 중간에 반을 떠난 학생 · 담임을 넘긴 반은 대상이 아니다.
 *   ⚠️ 마감한 달은 말일까지 입력된 기록만 — 말일에 본 시험을 다음 날 입력하면 그 학생은 미응시로 굳는다(다른 지표와 같은 마감 규칙).
 * - 🔴 두 종류는 **그 달 학원에 그 종류 기록이 있는 과목만**(침산은 둘 다 수학뿐) — 그 시험을 안 하는 과목(영어)에 미제출을 만들지 않고, 지난 달의
 *   한두 건이 다른 달을 바꾸지 않는다. 특강 반은 둘 다 대상이 아니다.
 * - 확인테스트 · 내신(학교 시험) · 기타 = 점수율(종전대로) — 시험은 그날 다니던 반의 담임에게(`attribution.ts`).
 * - 수치(raw) = 종류별 값(%)을 원장이 정한 비중으로 가중 평균 — 비중 0 = 안 센다. 대상이 없는 종류는 빠진다. 다 없으면 자료 없음.
 * - 마감한 달은 그 달 말일까지 입력된 기록만(진행 중인 달은 조회 시각까지) — 다른 지표와 같은 규칙.
 */
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { KIND_LABEL, scorePercent } from "@/features/grades/unified/model";
import type { GradesOptions } from "../evaluation/options";
import type { buildRecordOwners } from "./attribution";
import { between, round1 } from "./dates";
import { GRADE_KINDS, type GradeKind, type GradeKindStat, type GradeRow, type SnapshotGrade } from "./source-types";
import type { ChurnSource } from "./students";
import type { PeriodWindow, SnapshotClass } from "./types";

export const GRADES_REASON = "일일테스트는 제출률, 월말평가는 응시율, 확인테스트·내신은 점수율입니다. 일일테스트 = 이 선생님의 보고서 대상 칸(학생·수업일 — 결석·휴원·보강한 날 제외) 중 그날 일일테스트 기록이 있는 칸의 비율이고 점수는 보지 않습니다. 월말평가 = 그 달 마지막 날(진행 중인 달은 어제) 담임 반 명단 학생 중 그 달 월말평가 기록이 있는 학생의 비율이고, 안 봤으면 0%입니다(마감한 달은 말일까지 입력된 기록만). 두 가지는 그 달 학원에 그 시험 기록이 있는 과목만 세고, 특강 반은 제외합니다. 점수율 시험은 보고서의 시험이면 그 보고서의 반, 성적 입력이면 적힌 반(없으면 그날 그 과목으로 다니던 반)의 그날 담임에게 갑니다. 종류마다 값을 낸 뒤 학원 설정의 비중으로 가중 평균합니다. 입학·레벨 테스트와 시험없음은 제외합니다.";

/** 보고서 대상 칸 하나(`duties.ts` `reportTargets`) — 학생 · 수업일 · 그 칸의 반. */
export type GradeTarget = { studentId: string; day: string; classIds: readonly string[] };
export type GradesResult = { raw: number | null; tests: number; students: number; kinds: GradeKindStat[]; detail: GradeRow[] };

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}
const rateOf = (done: number, total: number) => round1((100 * done) / total);
const special = (c: SnapshotClass) => isSpecialLecture({ isSpecial: c.is_special, className: c.class_name });

export function buildGrades(input: {
  grades: readonly SnapshotGrade[]; ownersOf: ReturnType<typeof buildRecordOwners>;
  classes: ReadonlyMap<string, SnapshotClass>; rosterOf: ChurnSource["rosterOf"];
}) {
  // 점수율 시험은 강사 → [시험, 반 id]로 한 번만 잇는다. 일일테스트·월말평가는 학생·(날짜)·과목으로 찾는다(누구 몫인지는 대상 칸·명단이 정한다).
  const owned = new Map<string, { g: SnapshotGrade; classId: string }[]>();
  const daily = new Map<string, (string | null)[]>(); // 학생|날짜|과목 → 입력일들
  const monthly = new Map<string, { day: string; entered: string | null }[]>(); // 학생|과목
  const bySubject = { daily: new Map<string, SnapshotGrade[]>(), monthly: new Map<string, SnapshotGrade[]>() }; // 그 종류 기록 — 과목별
  for (const g of input.grades) {
    if (g.kind === "daily") {
      push(bySubject.daily, g.subject, g);
      push(daily, `${g.student_id}|${g.day}|${g.subject}`, g.entered);
    } else if (g.kind === "monthly") {
      push(bySubject.monthly, g.subject, g);
      push(monthly, `${g.student_id}|${g.subject}`, { day: g.day, entered: g.entered });
    } else {
      for (const { teacherId, classId } of input.ownersOf({ studentId: g.student_id, day: g.day, subjects: [g.subject], classId: g.class_id })) {
        push(owned, teacherId, { g, classId });
      }
    }
  }

  return function period(
    teacherId: string, w: PeriodWindow, cutoff: string, options: GradesOptions, classNameOf: (id: string) => string, targets: readonly GradeTarget[] = [],
  ): GradesResult {
    const counts = (entered: string | null) => !entered || entered <= cutoff;
    const on = (k: GradeKind) => (options.weights[k] ?? 0) > 0;
    type Row = { classes: Set<string>; scores: SnapshotGrade[]; daily?: { done: number; total: number }; monthly?: boolean };
    const perStudent = new Map<string, Row>();
    const rowOf = (id: string) => perStudent.get(id) ?? perStudent.set(id, { classes: new Set(), scores: [] }).get(id)!;
    const inWindow = (g: SnapshotGrade) => between(g.day, w.start, w.end) && counts(g.entered);
    // 그 달 학원에 그 종류 기록이 있는 과목 — 이 과목의 반만 대상(특강 반 제외).
    const subjectsWith = (rows: Map<string, SnapshotGrade[]>) => new Set([...rows].filter(([, xs]) => xs.some(inWindow)).map(([s]) => s));
    const targetClass = (subjects: ReadonlySet<string>) => (id: string) => {
      const c = input.classes.get(id);
      return c && subjects.has(c.subject) && !special(c) ? c : undefined;
    };

    // 일일테스트 = 제출률 — 칸마다 그날 그 과목 기록이 하나라도 있으면 제출.
    const submit = { done: 0, total: 0 };
    const dailyClass = on("daily") ? targetClass(subjectsWith(bySubject.daily)) : () => undefined;
    for (const t of targets) {
      const cs = t.classIds.flatMap((id) => dailyClass(id) ?? []);
      if (!cs.length || !between(t.day, w.start, w.end)) continue;
      const done = cs.some((c) => (daily.get(`${t.studentId}|${t.day}|${c.subject}`) ?? []).some(counts));
      const r = rowOf(t.studentId);
      for (const c of cs) r.classes.add(c.id);
      r.daily ??= { done: 0, total: 0 };
      r.daily.total += 1; submit.total += 1;
      if (done) { r.daily.done += 1; submit.done += 1; }
    }

    // 월말평가 = 응시율 — 그 달 마지막 날 담임 반 명단(원생상담과 같은 명단). 한 학생은 과목마다 한 번.
    const take = { done: 0, total: 0 };
    const monthlyClass = on("monthly") ? targetClass(subjectsWith(bySubject.monthly)) : () => undefined;
    for (const [studentId, rel] of on("monthly") ? input.rosterOf(w.end, teacherId) : []) {
      const subjects = new Set<string>();
      for (const id of rel.homeClasses) {
        const c = monthlyClass(id);
        if (!c) continue;
        rowOf(studentId).classes.add(c.id);
        subjects.add(c.subject);
      }
      for (const subject of subjects) {
        const took = (monthly.get(`${studentId}|${subject}`) ?? []).some((x) => between(x.day, w.start, w.end) && counts(x.entered));
        const r = rowOf(studentId);
        r.monthly = (r.monthly ?? true) && took; // 두 과목이면 둘 다 봐야 응시
        take.total += 1;
        if (took) take.done += 1;
      }
    }

    // 확인테스트·내신·기타 = 점수율.
    const scored = (owned.get(teacherId) ?? []).filter(({ g }) => between(g.day, w.start, w.end) && counts(g.entered) && on(g.kind));
    for (const { g, classId } of scored) {
      const r = rowOf(g.student_id);
      r.scores.push(g);
      r.classes.add(classId);
    }
    const pct = (g: SnapshotGrade) => scorePercent({ score: g.score, maxScore: g.max }) ?? 0;
    const avg = (xs: readonly SnapshotGrade[]) => xs.reduce((n, g) => n + pct(g), 0) / xs.length;

    const kinds: GradeKindStat[] = GRADE_KINDS.flatMap((kind): GradeKindStat[] => {
      const weight = options.weights[kind] ?? 0;
      if (weight <= 0) return [];
      if (kind === "daily") return submit.total ? [{ kind, measure: "submit", count: submit.total, done: submit.done, average: rateOf(submit.done, submit.total), weight }] : [];
      if (kind === "monthly") return take.total ? [{ kind, measure: "take", count: take.total, done: take.done, average: rateOf(take.done, take.total), weight }] : [];
      const xs = scored.filter((r) => r.g.kind === kind).map((r) => r.g);
      return xs.length ? [{ kind, measure: "score", count: xs.length, average: round1(avg(xs)), weight }] : [];
    });
    const weight = kinds.reduce((n, k) => n + k.weight, 0);
    const raw = weight > 0 ? round1(kinds.reduce((n, k) => n + k.average * k.weight, 0) / weight) : null;

    const dailyRate = (r: GradeRow) => (r.daily ? r.daily.done / r.daily.total : 2);
    const detail: GradeRow[] = [...perStudent].map(([studentId, r]) => ({
      studentId, className: [...r.classes].map(classNameOf).filter(Boolean).sort().join(", "),
      tests: r.scores.length, average: r.scores.length ? round1(avg(r.scores)) : null,
      kinds: GRADE_KINDS.map((k) => [k, r.scores.filter((g) => g.kind === k).length] as const).filter(([, n]) => n > 0)
        .map(([k, n]) => `${KIND_LABEL[k]} ${n}`).join(" · "),
      ...(r.daily ? { daily: r.daily } : {}), ...(r.monthly === undefined ? {} : { monthly: r.monthly }),
    })).sort((a, b) => a.className.localeCompare(b.className, "ko") || dailyRate(a) - dailyRate(b) || (a.average ?? 101) - (b.average ?? 101));
    return { raw, tests: scored.length, students: perStudent.size, kinds, detail };
  };
}
