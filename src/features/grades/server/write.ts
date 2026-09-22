import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { EXAM_SLOT_LABEL, type ExamSlotKey } from "../exam-slots";
import type { Term } from "../term";

/**
 * 성적 칸 **저장 단일 경로** — 격자·학생 상세 폼·엑셀 반영이 전부 여기로 들어온다.
 *
 * 🔑 한 칸의 주인은 `(학생, 과목, 년도, 학기, 시험 칸)`이다(0281a 유니크). 학교 시험이라 한 학생이
 *    같은 과목 반을 둘 들어도 성적은 하나 — 어느 반 화면에서 적어도 같은 칸이 갱신된다.
 * 🔴 `upsert`는 **payload에 있는 컬럼만** 갱신한다 — 그래서 `notes`를 싣지 않는다(학생 상세에서 적어
 *    둔 메모가 격자 저장 한 번에 지워지지 않게). 옛 `batchSaveScores`는 delete→insert라 메모가 날아갔다.
 * 🔴 점수가 비면(null) 그 칸을 **지운다** — 0점과 빈 칸은 다른 사실이다(0점은 그대로 저장된다).
 * ⚠️ `created_by`는 **마지막에 저장한 사람**이 된다(upsert가 행을 갱신하므로). 누가 언제 적었는지의
 *    정본은 감사로그(`exam_scores`)다.
 */

export type GradeWriteAxis = {
  subject: string;
  year: number;
  term: Term;
  slot: ExamSlotKey;
  /** 저장되는 행의 `taken_on`(시험일). 추이·급락 감지가 이 날짜로 줄을 세운다. */
  date: string;
  maxScore: number | null;
};

export type GradeWriteRow = {
  studentId: string;
  /** 어느 반 화면에서 적었는지(맥락 스냅샷). 유니크 축이 아니다. */
  classId: string | null;
  score: number | null;
  /**
   * 메모 — **값을 준 칸만** 바꾼다(`undefined`면 손대지 않는다).
   * 🔴 격자 저장은 이 값을 주지 않는다: 주면 PostgREST가 배열 전체에 `notes` 열을 만들어(빠진 행은 null)
   *    학생 상세에서 적어 둔 메모를 한 번에 지운다. 그래서 아래에서 **두 무리로 나눠** 쓴다.
   */
  notes?: string | null;
};

const CHUNK = 100; // 대량 `.in()` 414 회피([[#53]])

export async function writeGradeCells(
  axis: GradeWriteAxis,
  rows: GradeWriteRow[],
): Promise<{ saved: number; cleared: number }> {
  const user = await getCurrentUser();
  if (!user) throw new Error("로그인이 필요합니다");
  const supabase = await createClient();

  const toSave = rows.filter((r) => r.score != null);
  const toClear = rows.filter((r) => r.score == null);

  // 메모를 준 행과 안 준 행을 나눠 쓴다 — 한 배열에 섞으면 메모 없는 행이 기존 메모를 null로 덮는다.
  const cellOf = (r: GradeWriteRow) => ({
    tenant_id: user.tenantId,
    student_id: r.studentId,
    class_id: r.classId,
    subject: axis.subject,
    school_year: axis.year,
    term: axis.term,
    exam_slot: axis.slot,
    // 라벨도 함께 저장한다 — 0281a 전 화면(학생 타임라인·성적 급락 알림)이 시험 이름을 계속 읽는다.
    exam_name: EXAM_SLOT_LABEL[axis.slot],
    score: r.score,
    max_score: axis.maxScore,
    taken_on: axis.date,
    created_by: user.id,
  });
  const groups = [
    toSave.filter((r) => r.notes === undefined).map(cellOf),
    toSave.filter((r) => r.notes !== undefined).map((r) => ({ ...cellOf(r), notes: r.notes ?? null })),
  ].filter((g) => g.length > 0);
  for (const payload of groups) {
    const { error } = await supabase
      .from("student_grades")
      .upsert(payload, { onConflict: "tenant_id,student_id,subject,school_year,term,exam_slot" });
    if (error) throw new Error(`성적 저장 실패: ${error.message}`);
  }

  if (toClear.length > 0) {
    const ids = toClear.map((r) => r.studentId);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await supabase
        .from("student_grades")
        .delete()
        .eq("tenant_id", user.tenantId)
        .eq("subject", axis.subject)
        .eq("school_year", axis.year)
        .eq("term", axis.term)
        .eq("exam_slot", axis.slot)
        .in("student_id", ids.slice(i, i + CHUNK));
      if (error) throw new Error(`성적 삭제 실패: ${error.message}`);
    }
  }

  return { saved: toSave.length, cleared: toClear.length };
}

/**
 * 0281a(학기·시험 칸 컬럼)가 적용됐는가 — 요청당 한 번.
 *
 * 🔴 앱이 마이그레이션보다 먼저 배포될 수 있다([[#95]]: SQL은 원장이 손으로 적용한다). 컬럼이 없으면
 *    조회는 옛 모양으로 살고 **저장만 잠근다** — 열어 두면 전건이 PostgREST 400으로 실패한다.
 */
export const gradesSchemaReady = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { error } = await supabase.from("student_grades").select("exam_slot").limit(1);
  return !error;
});
