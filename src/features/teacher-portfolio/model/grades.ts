/**
 * 성적 관리 — 그 달 **담당 학생이 본 시험의 점수율**(원장 결정 10 *"성적관리에 등록된 성적 기준"* — 일일·확인테스트 ·
 * 월말평가 · 학교 시험). 순수 함수.
 *
 * - 시험 = 성적관리 통합 원장과 같은 기록·같은 갈래(`grades/unified` — 성적 입력 + 수업보고서의 일일·확인테스트).
 *   입학·레벨 테스트와 '시험없음'·점수 없는 칸은 뺀다(snapshot이 읽을 때 거른다).
 * - 누구 몫 = **그날 다니던 반의 담임**(성적엔 강사 칸이 없다 — 계획서 5번). 보고서 시험은 그 보고서의 반, 성적 입력은 반이 적혀
 *   있으면 그 반, 없으면 그날 그 과목으로 다니던 반 전부(보강 반 제외). 담임은 그날 기준(담임 이력).
 * - 수치(raw) = 종류별 평균 점수율(%)을 원장이 정한 비중으로 가중 평균 — 비중 0 = 그 종류는 안 센다. 시험이 없으면 자료 없음.
 * - 마감한 달은 그 달 말일까지 입력된 시험만(진행 중인 달은 조회 시각까지) — 다른 지표와 같은 규칙.
 */
import { KIND_LABEL, scorePercent } from "@/features/grades/unified/model";
import type { GradesOptions } from "../evaluation/options";
import type { buildRecordOwners } from "./attribution";
import { between, round1 } from "./dates";
import { GRADE_KINDS, type GradeKind, type GradeKindStat, type GradeRow, type SnapshotGrade } from "./source-types";
import type { PeriodWindow } from "./types";

export const GRADES_REASON = "그 달에 본인이 담임인 반의 학생이 본 시험(성적관리에 등록된 일일·확인테스트 · 월말평가 · 학교 시험)의 점수율입니다. 종류마다 평균을 낸 뒤 학원 설정의 비중으로 가중 평균합니다. 보고서의 시험은 그 보고서의 반, 성적 입력은 적힌 반(없으면 그날 그 과목으로 다니던 반)의 그날 담임에게 갑니다. 입학·레벨 테스트와 시험없음은 뺍니다.";

export type GradesResult = { raw: number | null; tests: number; students: number; kinds: GradeKindStat[]; detail: GradeRow[] };

export function buildGrades(input: { grades: readonly SnapshotGrade[]; ownersOf: ReturnType<typeof buildRecordOwners> }) {
  // 강사 → [시험, 반 id] — 한 번만 잇는다.
  const owned = new Map<string, { g: SnapshotGrade; classId: string }[]>();
  for (const g of input.grades) {
    for (const { teacherId, classId } of input.ownersOf({ studentId: g.student_id, day: g.day, subjects: [g.subject], classId: g.class_id })) {
      const list = owned.get(teacherId);
      if (list) list.push({ g, classId }); else owned.set(teacherId, [{ g, classId }]);
    }
  }

  return function period(teacherId: string, w: PeriodWindow, cutoff: string, options: GradesOptions, classNameOf: (id: string) => string): GradesResult {
    const rows = (owned.get(teacherId) ?? []).filter(({ g }) => between(g.day, w.start, w.end) && (!g.entered || g.entered <= cutoff)
      && (options.weights[g.kind] ?? 0) > 0);
    const pct = (g: SnapshotGrade) => scorePercent({ score: g.score, maxScore: g.max }) ?? 0;
    const avg = (xs: readonly SnapshotGrade[]) => xs.reduce((n, g) => n + pct(g), 0) / xs.length;
    const kinds: GradeKindStat[] = GRADE_KINDS.flatMap((kind) => {
      const xs = rows.filter((r) => r.g.kind === kind).map((r) => r.g);
      return xs.length ? [{ kind, count: xs.length, average: round1(avg(xs)), weight: options.weights[kind] }] : [];
    });
    const weight = kinds.reduce((n, k) => n + k.weight, 0);
    const raw = weight > 0 ? round1(kinds.reduce((n, k) => n + k.average * k.weight, 0) / weight) : null;
    const perStudent = new Map<string, { grades: SnapshotGrade[]; classes: Set<string> }>();
    for (const { g, classId } of rows) {
      const s = perStudent.get(g.student_id) ?? perStudent.set(g.student_id, { grades: [], classes: new Set() }).get(g.student_id)!;
      s.grades.push(g);
      s.classes.add(classId);
    }
    const detail: GradeRow[] = [...perStudent].map(([studentId, s]) => ({
      studentId, tests: s.grades.length, average: round1(avg(s.grades)),
      className: [...s.classes].map(classNameOf).filter(Boolean).sort().join(", "),
      kinds: GRADE_KINDS.map((k) => [k, s.grades.filter((g) => g.kind === k).length] as const).filter(([, n]) => n > 0)
        .map(([k, n]) => `${KIND_LABEL[k as GradeKind]} ${n}`).join(" · "),
    })).sort((a, b) => a.className.localeCompare(b.className, "ko") || a.average - b.average);
    return { raw, tests: rows.length, students: perStudent.size, kinds, detail };
  };
}
