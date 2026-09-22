"use server";

import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { kstToday } from "@/lib/date-kst";
import { EXAM_SLOT_LABEL } from "../exam-slots";
import { resolveGradeSelection, selectionSlotIsValid } from "../selection";
import { axisLabelFor } from "../subject-axis";
import { termLabel } from "../term";
import type { GradeEntry, GradeSheetRow } from "../types";
import { gradeWriteError } from "./access";
import { getGradeSheet } from "./queries";
import { gradesSchemaReady, writeGradeCells } from "./write";

export type GradeSaveState =
  | { error?: string; ok?: boolean; saved?: number; cleared?: number }
  | undefined;

/** 화면이 보내는 `entries` = `[{studentId, score}]`. 형식이 틀리면 null(저장 안 함). */
function parseEntries(raw: FormDataEntryValue | null): GradeEntry[] | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const out: GradeEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") return null;
      const { studentId, score } = item as { studentId?: unknown; score?: unknown };
      if (typeof studentId !== "string" || !studentId) return null;
      if (score === null || score === undefined) {
        out.push({ studentId, score: null });
        continue;
      }
      if (typeof score !== "number" || !Number.isFinite(score)) return null;
      out.push({ studentId, score });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * 성적 격자 저장 — **바뀐 칸만** 쓴다.
 *
 * 🔴 전건을 쓰지 않는 이유: 다시 저장할 때마다 손대지 않은 칸의 시험일·만점·기록자가 덮어써진다
 *    (어제 적은 중간고사 날짜가 오늘 날짜로 바뀐다). 그래서 지금 저장된 값과 대조해 **달라진 칸만** 보낸다.
 * 🔴 명단 밖 학생 id는 거절한다 — 화면을 우회해 POST로 남의 반 성적을 밀어 넣지 못하게([[#77]]).
 *    판정 근거는 클라가 보낸 값이 아니라 **서버가 다시 만든 그 학기 명단**이다.
 */
export async function saveGradeScores(
  _prev: GradeSaveState,
  formData: FormData,
): Promise<GradeSaveState> {
  const gate = await gradeWriteError();
  if (gate) return { error: gate };
  if (!(await gradesSchemaReady())) {
    return { error: "성적 표 준비(0281a)가 아직 적용되지 않아 저장할 수 없습니다" };
  }

  const settings = await getTenantSettings();
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const sel = resolveGradeSelection(
    {
      year: formData.get("year"),
      term: formData.get("term"),
      subject: formData.get("subject"),
      class: formData.get("class"),
      slot: formData.get("slot"),
      date: formData.get("date"),
      max: formData.get("max"),
    },
    { subjectOptions: subjects.options, todayIso: kstToday() },
  );
  if (!sel) return { error: "학원 설정에 과목이 없습니다" };
  if (!selectionSlotIsValid(sel)) return { error: "이 과목에 없는 시험입니다" };

  const entries = parseEntries(formData.get("entries"));
  if (!entries) return { error: "점수를 읽지 못했습니다" };

  const sheet = await getGradeSheet(sel);
  // 한 학생이 같은 과목 반을 둘 들으면 줄이 둘이다 — 값은 하나이므로 **먼저 만난 줄**(고른 반 우선,
  // 전체 보기에선 반 이름순 첫 줄)의 반을 입력 맥락으로 남긴다.
  const rowByStudent = new Map<string, GradeSheetRow>();
  for (const r of sheet.rows) if (!rowByStudent.has(r.studentId)) rowByStudent.set(r.studentId, r);

  const changed: { studentId: string; classId: string | null; score: number | null }[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.studentId)) continue; // 같은 학생이 두 줄이어도 값은 하나
    seen.add(e.studentId);
    const row = rowByStudent.get(e.studentId);
    if (!row) return { error: "이 학기 명단에 없는 학생이 있습니다" };
    if (e.score != null) {
      if (e.score < 0) return { error: "점수는 0점 이상이어야 합니다" };
      if (e.score > sel.maxScore) return { error: `점수는 만점(${sel.maxScore})을 넘을 수 없습니다` };
    }
    const score = e.score == null ? null : Math.round(e.score * 100) / 100; // numeric(6,2)
    const unchanged =
      score === row.score &&
      (score === null || (row.maxScore === sel.maxScore && row.takenOn === sel.date));
    if (unchanged) continue;
    changed.push({ studentId: e.studentId, classId: row.classId, score });
  }

  if (changed.length === 0) return { ok: true, saved: 0, cleared: 0 };

  let result: { saved: number; cleared: number };
  try {
    result = await writeGradeCells(
      {
        subject: sel.subject,
        year: sel.year,
        term: sel.term,
        slot: sel.slot,
        date: sel.date,
        maxScore: sel.maxScore,
      },
      changed,
    );
  } catch (err) {
    // 원문은 화면에 그대로 내보내지 않는다(raw 노출 금지) — 한글 요약만.
    console.error("[grades] saveGradeScores", err);
    return { error: "성적을 저장하지 못했습니다" };
  }

  await logAction({
    action: "exam_scores",
    targetType: "grades",
    targetLabel: `${termLabel(sel.year, sel.term)} · ${axisLabelFor(sel, subjects.labelOf)} · ${EXAM_SLOT_LABEL[sel.slot]}`,
    metadata: {
      subject: sel.subject,
      year: sel.year,
      term: sel.term,
      slot: sel.slot,
      classId: sel.classId,
      saved: result.saved,
      cleared: result.cleared,
      students: sheet.rows.length,
    },
  });

  revalidatePath("/exams");
  // 성적은 학생 상세(성적 탭·타임라인)도 읽는다 — 바뀐 학생 화면만 다시 그린다.
  for (const c of changed) revalidatePath(`/students/${c.studentId}`);

  return { ok: true, saved: result.saved, cleared: result.cleared };
}
