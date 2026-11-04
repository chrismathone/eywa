import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { examSlotLabel, GRADE_MONTH_NOT_READY, gradeMonthOf, slotUsesMonth, type ExamSlotKey } from "../exam-slots";
import type { AreaScores } from "../area-scores";
import type { Term } from "../term";
import { gradeCellKeeps } from "../keep";
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
  /**
   * 이 저장이 **안 건드리는데 이미 켜져 있는** 표식이 있는가(호출부가 방금 읽은 DB 값).
   * 🔴 삭제 판정에만 쓴다 — 없으면 부분 패치 저장이 숨은 표식을 통째로 지운다([[keep.ts]] 주석).
   */
  otherMarks?: boolean;
  /**
   * 사람이 누른 '시험없음'과 사유 — `undefined`면 안 건드린다.
   * 🔴 켜면 점수를 비운다(둘은 같이 못 선다) · 켜진 칸은 점수가 없어도 **행을 남긴다**(사유가 기록이다).
   */
  noExam?: boolean;
  noExamReason?: string | null;
  /**
   * 영역 점수(영어 Monthly Test, s2_0023) — `undefined`면 안 건드린다 · null이면 지운다.
   * 🔴 점수(`score`)는 호출부가 이 값의 합으로 이미 맞춰 보낸다(합을 여기서 다시 셈하지 않는다).
   */
  areas?: AreaScores | null;
};

/** 영역 점수 칸(s2_0023)이 아직 없을 때 영역 저장의 사유 — 사람이 고칠 수 있는 사유라 그대로 화면에 낸다. */
export const GRADE_AREAS_NOT_READY = "영역 점수 준비(s2_0023)가 아직 적용되지 않아 Monthly Test는 저장할 수 없습니다";

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
  const user = await getCurrentUser({ teacherView: true });
  if (!user) throw new Error("로그인이 필요합니다");
  const supabase = await createClient();
  // 🔴 월 축(0288a) — 월말평가는 달마다 다른 칸이다. 적용 전에는 옛 유니크 축 그대로 쓴다([[#95]]):
  //    컬럼이 없는데 `onConflict`에 넣으면 저장이 전건 실패한다(42P10).
  const monthReady = await gradeMonthReady();
  const month = gradeMonthOf(axis.slot, axis.date);
  // 🔴 준비 전에는 **월말평가 저장만 막는다**(fail-closed) — 옛 축으로 쓰면 10월이 9월을 조용히
  //    덮는다. 화면도 같은 이유로 입력을 잠그지만, 게이트는 여기가 정본이다([[#77]]: 엑셀·학생
  //    상세 폼도 이 함수를 지난다). 다른 시험은 원래 학기에 한 번이라 영향이 없다.
  if (!monthReady && slotUsesMonth(axis.slot)) {
    throw new Error(GRADE_MONTH_NOT_READY);
  }
  // 영역 점수 칸(s2_0023)이 없는데 영역을 보내면 전건 400이다 — 영역 저장만 막는다([[#95]]).
  if (rows.some((r) => r.areas !== undefined) && !(await gradeAreasReady())) {
    throw new Error(GRADE_AREAS_NOT_READY);
  }
  const CONFLICT_WITH_MONTH = "tenant_id,student_id,subject,school_year,term,exam_slot,exam_month";
  const CONFLICT_LEGACY = "tenant_id,student_id,subject,school_year,term,exam_slot";
  const conflict = monthReady ? CONFLICT_WITH_MONTH : CONFLICT_LEGACY;

  // 🔑 남길 칸 = **점수가 있거나 표식이 하나라도 켜진 칸**. 점수가 없어도 "1차 독촉함"은 남아야 한다.
  //    점수도 표식도 없으면 그 행은 존재할 이유가 없으니 지운다.
  // 🔴 판정은 순수 모듈 하나([`gradeCellKeeps`](../keep.ts)) — 부분 패치만 보고 지우면 이 저장이
  //    건드리지도 않은 표식이 함께 사라진다(`otherMarks`가 그걸 막는다).
  const keeps = (r: GradeWriteRow) => gradeCellKeeps(r);
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
    exam_name: examSlotLabel(axis.subject, axis.slot),
    score: r.score,
    max_score: axis.maxScore,
    taken_on: axis.date,
    ...(monthReady ? { exam_month: month } : {}),
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
    [
      r.notes === undefined ? "" : "n",
      GRADE_MARK_KEYS.filter((k) => r.marks?.[k] !== undefined).join(","),
      r.noExam === undefined ? "" : "x",
      r.areas === undefined ? "" : "a",
    ].join("|");
  const byShape = new Map<string, Record<string, unknown>[]>();
  for (const r of toSave) {
    const payload = {
      ...cellOf(r),
      ...(r.notes === undefined ? {} : { notes: r.notes ?? null }),
      ...marksOf(r),
      ...(r.noExam === undefined
        ? {}
        : { no_exam: r.noExam, no_exam_reason: r.noExam ? (r.noExamReason ?? null) : null }),
      ...(r.areas === undefined ? {} : { area_scores: r.areas }),
    };
    const key = shapeOf(r);
    byShape.set(key, [...(byShape.get(key) ?? []), payload]);
  }
  const groups = [...byShape.values()];
  for (const payload of groups) {
    const { error } = await supabase
      .from("student_grades")
      .upsert(payload, { onConflict: conflict });
    if (!error) continue;
    // 🔴 42P10 = `on conflict`가 가리킨 인덱스가 없다. 0288a를 적용하는 **그 몇 초**에 컬럼과 인덱스가
    //    엇갈릴 수 있어(스키마 캐시 지연 포함) 한 번만 반대 축으로 되돌려 시도한다 — 안 그러면 그 순간
    //    저장 전건이 실패한다.
    // 🔴🔴 **월말평가는 절대 되돌리지 않는다** — 옛 축(월 없음)으로 쓰면 10월 저장이 9월 행을 덮는다
    //    (고치려던 바로 그 버그가 이 예외 경로로 되살아난다, 적대적 리뷰 2026-09-23). 위 fail-closed
    //    가드는 **컬럼이 없을 때**만 걸려서, 컬럼은 생기고 인덱스는 아직인 순간을 못 막는다.
    const isMissingIndex = (error as { code?: string }).code === "42P10";
    if (!isMissingIndex || slotUsesMonth(axis.slot)) throw new Error(`성적 저장 실패: ${error.message}`);
    const other = conflict === CONFLICT_WITH_MONTH ? CONFLICT_LEGACY : CONFLICT_WITH_MONTH;
    const retry = await supabase.from("student_grades").upsert(payload, { onConflict: other });
    if (retry.error) throw new Error(`성적 저장 실패: ${retry.error.message}`);
  }

  if (toClear.length > 0) {
    const ids = toClear.map((r) => r.studentId);
    for (let i = 0; i < ids.length; i += CHUNK) {
      // 🔴 지울 때도 **월을 좁힌다** — 안 좁히면 10월 칸을 비우는 한 번에 9월·11월 월말평가가 함께 사라진다.
      let q = supabase
        .from("student_grades")
        .delete()
        .eq("tenant_id", user.tenantId)
        .eq("subject", axis.subject)
        .eq("school_year", axis.year)
        .eq("term", axis.term)
        .eq("exam_slot", axis.slot);
      if (monthReady) q = q.eq("exam_month", month);
      const { error } = await q
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
export const gradesSchemaReady = cache(async () => columnExists("exam_slot"));

/**
 * 그 컬럼이 **있는가** — 준비 플래그 넷이 공유하는 판정.
 *
 * 🔴 "조회 실패 = 미준비"로 읽지 말 것(적대적 리뷰 2026-09-23) — 일시적 실패 한 번에 월 필터가
 *    빠져서 9월 화면이 10월 점수를 보여 주고, 표식 플래그에선 **표식이 있는 행을 지우는** 판정까지
 *    간다. 컬럼이 없다는 **그 오류**(PostgREST 42703/PGRST204)만 미준비로 본다.
 */
async function columnExists(column: string): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase.from("student_grades").select(column).limit(1);
  if (!error) return true;
  const code = (error as { code?: string }).code ?? "";
  return !(code === "42703" || code === "PGRST204" || /does not exist|column/i.test(error.message));
}

/**
 * 0284a(성적표 받기 표식)가 적용됐는가 — **점수 저장과 따로** 본다.
 * 🔴 하나로 묶지 말 것: 묶으면 표식 마이그레이션이 늦어지는 동안 이미 열려 있던 점수 저장까지 멈춘다.
 */
export const gradeMarksReady = cache(async () => columnExists("ask1_at"));

/**
 * 0288a(월 축)가 적용됐는가 — 위 셋과 **따로** 본다(같은 이유).
 * 🔴 false면 월말평가는 학기에 한 칸이라 다음 달이 지난달을 덮는다 → 화면이 배너로 그 사실을 말한다.
 */
export const gradeMonthReady = cache(async () => columnExists("exam_month"));

/** s2_0023(영역 점수)이 적용됐는가 — 위 넷과 **따로** 본다(같은 이유). */
export const gradeAreasReady = cache(async () => columnExists("area_scores"));

/** 0285a('시험없음'·사유)가 적용됐는가 — 위 둘과 **따로** 본다(같은 이유). */
export const gradeNoExamReady = cache(async () => columnExists("no_exam"));

/**
 * **시험 칸 축이 없는** 행(옛 이관분·통합 원장의 일일·확인·입학 기록) 쓰기 — 통합 원장 전용 두 갈래.
 * 🔴 학기·시험 칸이 있는 행은 여기로 오지 말 것 — `writeGradeCells`(= `saveGradeScores`)가 단일 경로다.
 *    그래도 이 파일에 두는 이유: `student_grades` 쓰기가 한 모듈에 모여 있어야 가드가 새 우회로를 잡는다
 *    (`grades-wiring.test.ts` '쓰는 곳은 write.ts 하나'). 실패는 **DB 원문**을 돌려주고 화면이 한글로 바꾼다.
 */
export async function updateUnslottedGrade(tenantId: string, id: string,
  patch: { score: number | null; max_score: number | null; taken_on: string }): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("student_grades").update(patch)
    .eq("id", id).eq("tenant_id", tenantId).select("id").maybeSingle();
  if (error) return error.message;
  return data ? null : "성적 기록을 찾지 못했습니다";
}

export type UnifiedGradePatch = {
  score: number | null;
  max_score: number | null;
  taken_on: string;
  no_exam?: boolean;
  no_exam_reason?: null;
  exam_month?: number;
};

/** 통합 성적 화면의 행 수정도 이 모듈에서 실행한다. 호출부가 학생·과목 쓰기 권한을 확인한다. */
export async function updateUnifiedGrade(tenantId: string, id: string,
  patch: UnifiedGradePatch): Promise<string | null> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || user.tenantId !== tenantId) return "로그인이 필요합니다";
  const supabase = await createClient();
  const { data, error } = await supabase.from("student_grades").update(patch)
    .eq("id", id).eq("tenant_id", tenantId).select("id").maybeSingle();
  if (error) return error.message;
  return data ? null : "성적 기록을 찾지 못했습니다";
}

export async function insertUnslottedGrade(row: { tenant_id: string; student_id: string; subject: string; exam_name: string;
  taken_on: string; score: number | null; max_score: number; created_by: string }): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await supabase.from("student_grades").insert(row);
  return error?.message ?? null;
}
