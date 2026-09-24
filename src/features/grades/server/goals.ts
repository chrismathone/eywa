import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { isExamSlot, type ExamSlotKey } from "../exam-slots";
import { isTerm, type Term } from "../term";
import { goalCellKey, goalStatus, recordCellKey, type GoalView } from "../goals";
import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * 시험 목표 조회 — 학생 상세·/exams가 **같은 함수**로 읽는다(원장 2026-09-24, codex 합의).
 * 🔴 0291a(목표 축 컬럼)는 원장이 손으로 적용한다 — 적용 전엔 옛 컬럼만 읽고(축 = null → 이름 매칭), 새 목표 저장만 잠근다([[#95]]).
 */

export type GoalRecord = {
  id: string; studentId: string; subject: string; examName: string;
  target: number; max: number | null; reason: string | null; createdAt: string;
  /** 성적 칸 축 — 0291a 전·옛 목표는 null(이름 매칭 폴백). */
  axis: { year: number; term: Term; slot: ExamSlotKey; month: number } | null;
};

/**
 * 0291a가 적용됐는가 — **컬럼이 없다는 그 오류**만 미준비로 본다(일시 실패를 미준비로 읽으면 새 목표가 이름 매칭으로 샌다,
 * write.ts `columnExists`와 같은 규약).
 */
export const goalAxisReady = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { error } = await supabase.from("grade_goals").select("school_year").limit(1);
  if (!error) return true;
  const code = (error as { code?: string }).code ?? "";
  if (code === "42703" || code === "PGRST204" || /does not exist/i.test(error.message)) return false;
  throw new Error(`목표 조회 실패: ${error.message}`);
});

type RawGoal = {
  id: string; student_id: string; subject: string; exam_name: string; target_score: string | number; max_score: string | number | null;
  reason: string | null; created_at: string; school_year?: number | null; term?: number | null; exam_slot?: string | null; exam_month?: number | null;
};

/** 학생들의 목표 전부(최신 먼저). 호출부가 이미 권한 범위로 거른 학생 id만 넘긴다. */
export async function loadGoals(tenantId: string, studentIds: string[]): Promise<GoalRecord[]> {
  if (!studentIds.length) return [];
  const supabase = await createClient();
  const cols = `id, student_id, subject, exam_name, target_score, max_score, reason, created_at${(await goalAxisReady()) ? ", school_year, term, exam_slot, exam_month" : ""}`;
  const rows = await fetchAllPagedInChunks<RawGoal>(studentIds, (chunk, start, end) => supabase.from("grade_goals")
    .select(cols).eq("tenant_id", tenantId).in("student_id", chunk).order("id").range(start, end) as unknown as PromiseLike<{ data: RawGoal[] | null; error: { message: string } | null }>);
  return rows.map((r) => {
    const term = Number(r.term);
    const axis = r.school_year != null && isTerm(term) && isExamSlot(r.exam_slot)
      ? { year: r.school_year, term, slot: r.exam_slot, month: r.exam_month ?? 0 } : null;
    return { id: r.id, studentId: r.student_id, subject: r.subject, examName: r.exam_name,
      target: Number(r.target_score), max: r.max_score == null ? null : Number(r.max_score),
      reason: r.reason, createdAt: r.created_at, axis };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * 통합 기록 줄마다 붙일 **목표 대비** — /exams 성적 현황·학생 추이·원생 상세 성적 목록이 이 함수 하나로 만든다.
 * 줄의 칸 키(`recordCellKey`)와 목표의 축이 **정확히 같을 때만** 붙이고, 상태는 그 줄의 점수로 판정한다(`goalStatus`).
 * 🔴 축 없는 옛 목표(0291a 전·이름만)는 줄에 안 붙인다 — 이름 매칭은 다른 해 성적에 붙는다(목표 구역에서만 이름으로 읽는다).
 */
export async function goalViewsForRows(rows: readonly {
  key: string; studentId: string; source: string; subject: string; slot?: string; schoolYear?: number; term?: number;
  date: string; score: number | null; maxScore: number | null; noExam?: boolean;
}[]): Promise<Record<string, GoalView>> {
  const keyed = rows.map((r) => ({ r, cell: recordCellKey(r) })).filter((x): x is { r: (typeof rows)[number]; cell: string } => x.cell != null);
  if (!keyed.length) return {};
  const user = await getCurrentUser();
  if (!user) return {};
  // 줄에 붙는 목표는 **곁들임**이다 — 목표 조회가 실패해도 성적 표(매일 쓰는 화면)는 서야 한다. 목표 구역(getStudentGradeGoals)은 오류를 그대로 드러낸다.
  let goals: GoalRecord[];
  try {
    goals = await loadGoals(user.tenantId, [...new Set(keyed.map((x) => x.r.studentId))]);
  } catch (e) {
    console.error("[goalViewsForRows] 목표 조회 실패 — 줄 목표 표시 없이 진행", e);
    return {};
  }
  const byKey = new Map<string, GoalRecord>();
  for (const g of goals) if (g.axis) byKey.set(`${g.studentId}|${goalCellKey({ subject: g.subject, ...g.axis })}`, g);
  const out: Record<string, GoalView> = {};
  for (const { r, cell } of keyed) {
    const g = byKey.get(`${r.studentId}|${cell}`);
    if (g) out[r.key] = { target: g.target, max: g.max, status: goalStatus({ target: g.target, max: g.max }, { score: r.score, max: r.maxScore, noExam: r.noExam }) };
  }
  return out;
}
