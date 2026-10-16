/**
 * 학부모 만족도 — 그 달 학부모 글 판정(반영한 것)과 원장이 넣은 클레임의 **가감 합**(원장 2026-10-13 *"총점에 그대로 더하고 뺀다"*). 순수 함수.
 *
 * - 글 판정 = 학부모 글 한 건에 하나(0364a · 판정은 `server/satisfaction-judge.ts`). 반영한 것만 점수 — 확인 대기는 근거에 보이되 0점.
 *   점수는 **그 달 설정**의 근거 문구 점수(문구가 목록에 없거나 AI·사람 판정이면 가점·감점 기본 점수).
 * - 누구 몫 = 글의 반 보드(있으면) 또는 그 과목으로 그날 다니던 반의 담임(성적 관리와 같은 규칙 `attribution.ts`).
 * - 클레임 = 원장이 강사를 골라 넣은 ± 점수(취소한 것은 스냅샷이 뺀다).
 * - 판정 표가 아직 없으면(SQL 적용 전) null — 그 지표는 '계산 전'으로 남는다. 표가 있으면 아무 일도 없던 달은 0.
 */
import type { SatisfactionOptions } from "../evaluation/options";
import type { buildRecordOwners } from "./attribution";
import { between } from "./dates";
import { verdictPoints } from "./satisfaction-rules";
import type { EvaluationSources, SatisfactionRow, SnapshotJudgment } from "./source-types";
import type { PeriodWindow } from "./types";

export type SatisfactionResult = { raw: number; plus: number; minus: number; claims: number; waiting: number; detail: SatisfactionRow[] };
const HOW: Record<SnapshotJudgment["method"], string> = { rule: "문구", ai: "AI 판정 · 사람 확인", manual: "사람 판정" };

export function buildSatisfaction(input: { source: EvaluationSources["satisfaction"]; ownersOf: ReturnType<typeof buildRecordOwners> }) {
  const source = input.source;
  if (!source) return null;
  // 글마다 이 선생님에게 온 반도 함께 — 근거 표·만족도 관리가 반 이름을 보인다(원장 2026-10-16).
  // 한 글이 두 선생님 몫이면(과목 둘 · 담임 둘) 서로를 적어 둔다 — 판정 줄은 하나라 한쪽 창의 반영이 다른 쪽 점수도 움직인다(적대적 리뷰 2026-10-16).
  const byTeacher = new Map<string, { j: SnapshotJudgment; classId: string; others: string[] }[]>();
  for (const j of source.judgments) {
    const owners = input.ownersOf({ studentId: j.student_id, day: j.posted_on, subjects: j.subjects, classId: j.class_id });
    for (const { teacherId, classId } of owners) {
      const entry = { j, classId, others: owners.filter((o) => o.teacherId !== teacherId).map((o) => o.teacherId) };
      const list = byTeacher.get(teacherId);
      if (list) list.push(entry); else byTeacher.set(teacherId, [entry]);
    }
  }
  return function period(teacherId: string, w: PeriodWindow, o: SatisfactionOptions, classNameOf: (id: string) => string = () => ""): SatisfactionResult {
    const judged = (byTeacher.get(teacherId) ?? []).filter(({ j }) => between(j.posted_on, w.start, w.end));
    const claims = source.claims.filter((c) => c.teacher_id === teacherId && between(c.occurred_on, w.start, w.end));
    const detail: SatisfactionRow[] = [
      ...judged.map(({ j, classId, others }): SatisfactionRow => {
        const waiting = j.state !== "applied" || !j.verdict;
        return {
          key: j.id, source: "글", day: j.posted_on, studentId: j.student_id, text: j.phrase, waiting, className: classNameOf(classId),
          ...(others.length ? { sharedWith: others } : {}),
          points: waiting ? null : verdictPoints(j.verdict!, j.phrase, o),
          how: waiting ? `확인 대기${j.verdict ? ` · ${j.verdict === "plus" ? "가점" : "감점"} 제안` : ""}` : HOW[j.method],
        };
      }),
      ...claims.map((c): SatisfactionRow => ({ key: c.id, source: "클레임", day: c.occurred_on, studentId: c.student_id, points: c.points, text: c.content, how: "직접 입력", waiting: false })),
    ].sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
    const counted = detail.filter((r) => r.points !== null);
    return {
      raw: Math.round(counted.reduce((n, r) => n + (r.points ?? 0), 0) * 10) / 10,
      plus: counted.filter((r) => r.source === "글" && (r.points ?? 0) > 0).length,
      minus: counted.filter((r) => r.source === "글" && (r.points ?? 0) < 0).length,
      claims: claims.length, waiting: detail.filter((r) => r.waiting).length, detail,
    };
  };
}
