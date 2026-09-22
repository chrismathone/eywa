import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { EXAM_SLOT_LABEL, type ExamSlotKey } from "../exam-slots";
import type { Term } from "../term";
import { GRADE_MARK_KEYS, type GradeMarkKey } from "../types";

/**
 * 성적 칸 **저장 단일 경로** — 격자·학생 상세 폼·엑셀 반영이 전부 여기로 들어온다.
 *
 * 🔑 한 칸의 주인은 `(학생, 과목, 년도, 학기, 시험 칸)`이다(0283a 유니크). 학교 시험이라 한 학생이
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
   *    학생 상세에서 적어 둔 메모를 한 번에 지운다. 그래서 아래에서 **무리로 나눠** 쓴다.
   */
  notes?: string | null;
  /**
   * 성적표 받기 표식 — 키마다 **쓸 시각(ISO) 또는 null**. `undefined`면 그 칸은 안 건드린다.
   * 이미 눌러 둔 표식은 호출부가 **옛 시각을 그대로** 넘겨 유지한다(다시 누른 것으로 만들지 않는다).
   */
  marks?: Partial<Record<GradeMarkKey, string | null>>;
};

const MARK_COL: Record<GradeMarkKey, { at: string; by: string }> = {
  ask1: { at: "ask1_at", by: "ask1_by" },
  ask2: { at: "ask2_at", by: "ask2_by" },
  received: { at: "received_at", by: "received_by" },
};

const CHUNK = 100; // 대량 `.in()` 414 회피([[#53]])

export async function writeGradeCells(
  axis: GradeWriteAxis,
  rows: GradeWriteRow[],
): Promise<{ saved: number; cleared: number }> {
  const user = await getCurrentUser();
  if (!user) throw new Error("로그인이 필요합니다");
  const supabase = await createClient();

  // 🔑 남길 칸 = **점수가 있거나 표식이 하나라도 켜진 칸**. 점수가 없어도 "1차 독촉함"은 남아야 한다.
  //    점수도 표식도 없으면 그 행은 존재할 이유가 없으니 지운다.
  const keeps = (r: GradeWriteRow) =>
    r.score != null || GRADE_MARK_KEYS.some((k) => !!r.marks?.[k]);
  const toSave = rows.filter(keeps);
  const toClear = rows.filter((r) => !keeps(r));

  // 메모를 준 행과 안 준 행을 나눠 쓴다 — 한 배열에 섞으면 메모 없는 행이 기존 메모를 null로 덮는다.
  const cellOf = (r: GradeWriteRow) => ({
    tenant_id: user.tenantId,
    student_id: r.studentId,
    class_id: r.classId,
    subject: axis.subject,
    school_year: axis.year,
    term: axis.term,
    exam_slot: axis.slot,
    // 라벨도 함께 저장한다 — 0283a 전 화면(학생 타임라인·성적 급락 알림)이 시험 이름을 계속 읽는다.
    exam_name: EXAM_SLOT_LABEL[axis.slot],
    score: r.score,
    max_score: axis.maxScore,
    taken_on: axis.date,
    created_by: user.id,
  });
  // 표식은 준 키만 payload에 실린다(안 준 칸을 null로 덮지 않게).
  const marksOf = (r: GradeWriteRow): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of GRADE_MARK_KEYS) {
      const v = r.marks?.[k];
      if (v === undefined) continue;
      out[MARK_COL[k].at] = v;
      out[MARK_COL[k].by] = v ? user.id : null;
    }
    return out;
  };
  // 🔴 upsert는 **배열 전체에 같은 열 집합**을 만든다(빠진 행은 null) — 그래서 "어떤 선택 열을 들었나"가
  //    같은 행끼리 묶어 따로 쓴다. 안 그러면 메모만 보낸 저장이 남의 표식을, 표식만 보낸 저장이 남의
  //    메모를 지운다.
  const shapeOf = (r: GradeWriteRow) =>
    `${r.notes === undefined ? "" : "n"}|${GRADE_MARK_KEYS.filter((k) => r.marks?.[k] !== undefined).join(",")}`;
  const byShape = new Map<string, Record<string, unknown>[]>();
  for (const r of toSave) {
    const payload = {
      ...cellOf(r),
      ...(r.notes === undefined ? {} : { notes: r.notes ?? null }),
      ...marksOf(r),
    };
    const key = shapeOf(r);
    byShape.set(key, [...(byShape.get(key) ?? []), payload]);
  }
  const groups = [...byShape.values()];
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
 * 0283a(학기·시험 칸 컬럼)가 적용됐는가 — 요청당 한 번.
 *
 * 🔴 앱이 마이그레이션보다 먼저 배포될 수 있다([[#95]]: SQL은 원장이 손으로 적용한다). 컬럼이 없으면
 *    조회는 옛 모양으로 살고 **저장만 잠근다** — 열어 두면 전건이 PostgREST 400으로 실패한다.
 */
export const gradesSchemaReady = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { error } = await supabase.from("student_grades").select("exam_slot").limit(1);
  return !error;
});

/**
 * 0284a(성적표 받기 표식)가 적용됐는가 — **점수 저장과 따로** 본다.
 * 🔴 하나로 묶지 말 것: 묶으면 표식 마이그레이션이 늦어지는 동안 이미 열려 있던 점수 저장까지 멈춘다.
 */
export const gradeMarksReady = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { error } = await supabase.from("student_grades").select("ask1_at").limit(1);
  return !error;
});
