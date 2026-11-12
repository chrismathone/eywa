import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateJSON } from "@/lib/ai/generate";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import { kstToday } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { homeworkDueText } from "@/features/video-homework/due";
import { appendVideoReceiptComment } from "@/features/video-homework/receipt-comment";
import { getVideoReceiptComment } from "@/features/video-homework/server/receipt-comment";
import { detectClassNotices, splitNoticeFromNote } from "../class-notice";
import { mentMaxTokens, mentSections, readMentResponse, stripSubjectLabel, type MentTemplates } from "../ment-assembly";
import { formatMentPreview } from "../ment-preview-format";
import {
  classNoteRows,
  entryOf,
  noteOfEntry,
  pickPrior,
  pickSession,
  previewTestLines,
  progressModeOf,
  type PreviewSession,
  type PriorReport,
  type RowKey,
} from "../ment-preview-input";
import { mentStyleDirective, mentStyleToneDirective } from "../ment-style-prompt";
import { prependParentAddress, splitParentAddress } from "../parent-address";
import { assembleCombined, MENT_AI_TUNING, PROMPT_TYPES, type PromptType } from "../prompt-defaults";
import type { ReportCommentInput } from "../report-comment";
import { buildTrendInput, TREND_HISTORY_FETCH_DAYS } from "../trend-comment";
import { loadTeacherMentStyle } from "./ment-style-db";
import { loadActivePrompt } from "./prompt-loader";
import { fetchScoreHistory, fetchSpecialClassIds } from "./score-history";

/**
 * AI 멘트 탭 '실데이터로 테스트' — **운영 자동작성과 같은 재료·조립·모델·검사**로 그 보고서를 다시 써 본다(저장 없음).
 * 🔴 원장 2026-10-16 후속: 미리보기가 특이사항 없이·Sonnet으로·추세 검사 없이 돌아 실제 글과 달랐다. 조립·응답 읽기 = ment-assembly.ts,
 *    입력을 다시 만드는 규칙 = ment-preview-input.ts(그 보고서를 쓴 선생님의 그날 세션 · 반 전체 안내 · 말투 · 공지 모드 · 직전 회차 증감).
 *    ⚠️ 반 공통 서술(화면 임시 칸)은 어디에도 남지 않아 넣을 수 없다 — 결과 글에 밝힌다.
 */

const str = (v: unknown) => (typeof v === "string" ? v : "");
type Row = Record<string, unknown>; // 조회는 서로 독립인 것끼리 한 번에(B4)
const SESSION_COLS = "class_id, updated_by, subject_progress, special_note";

/** 조회 오류를 빈 값으로 삼키지 않는다 — 재료가 빠진 미리보기는 실제와 다른 글을 '실제'라고 보여 준다. */
function must<T = Row>(res: { data: unknown; error: { message: string } | null }, what: string): T | null {
  if (res.error) throw new Error(`${what}을(를) 읽지 못했습니다`);
  return (res.data as T | null) ?? null;
}

async function loadTemplates(db: SupabaseClient, tenantId: string, edited: PromptType, text: string): Promise<MentTemplates> {
  const vals = await Promise.all(PROMPT_TYPES.map((t) => (t === edited ? Promise.resolve(text) : loadActivePrompt(db, tenantId, t))));
  const by = Object.fromEntries(PROMPT_TYPES.map((t, i) => [t, vals[i] ?? null]));
  return { comment: by.comment ?? null, comment_p1: by.comment_p1 ?? null, comment_p2: by.comment_p2 ?? null, trend: by.trend ?? null };
}

export async function runMentPreview(
  db: SupabaseClient,
  tenantId: string,
  type: PromptType,
  text: string,
  reportId: string,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const r = must(
    await db
      .from("lesson_reports")
      .select("student_id, class_id, subject, makeup, created_by, report_date, exam_info, progress, daily_test, check_test, attitude, homework_score, textbook, homework_today, video_homework, video_homework_due")
      .eq("tenant_id", tenantId)
      .eq("id", reportId)
      .maybeSingle(),
    "보고서",
  );
  if (!r) return { ok: false, error: "보고서를 찾을 수 없습니다" };
  const subjectKey = str(r.subject);
  // 영어 행은 원스크린에서 템플릿 모드라 이 프롬프트를 쓰지 않는다(onescreen-client.tsx) — 시험해도 실제와 다른 글이다.
  if (subjectKey === "english") return { ok: false, error: "영어 보고서는 템플릿으로 쓰여 이 프롬프트를 쓰지 않습니다 — 다른 보고서를 선택하세요" };
  const studentId = r.student_id as string;
  // 화면의 그 행 — 보강만 있는 행은 반이 비고 칸 키가 `makeup::과목`이다(roster.ts).
  const row: RowKey = { classId: (r.class_id as string | null) ?? null, makeup: r.makeup === true, subjectKey: subjectKey || "math" };
  const classId = row.classId;
  const reportDate = (r.report_date as string | null) ?? kstToday();

  const [stuRes, settings, sessRes, specialClassIds, priorRes, templates, receipt] = await Promise.all([
    db.from("students").select("name").eq("tenant_id", tenantId).eq("id", studentId).maybeSingle(),
    getTenantSettings(),
    db.from("onescreen_daily_sessions").select(SESSION_COLS).eq("tenant_id", tenantId).eq("student_id", studentId).eq("session_date", reportDate),
    fetchSpecialClassIds(db),
    db
      .from("lesson_reports")
      .select("class_id, subject, exam_info")
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .lt("report_date", reportDate)
      .order("report_date", { ascending: false })
      .limit(10),
    loadTemplates(db, tenantId, type, text),
    getVideoReceiptComment(tenantId, { studentId, classId, date: reportDate }).catch(() => null),
  ]);
  const studentName = str(must(stuRes, "학생")?.name);
  const own = pickSession(must<PreviewSession[]>(sessRes, "원스크린 기록") ?? [], row, (r.created_by as string | null) ?? null);
  const teacherId = own?.updated_by ?? null;

  const [rosterRes, teacherRes, mentStyle, history] = await Promise.all([
    teacherId ? db.from("onescreen_daily_sessions").select(SESSION_COLS).eq("tenant_id", tenantId).eq("session_date", reportDate).eq("updated_by", teacherId) : null,
    // 🔴 이름 칸은 `display_name`이다 — `name`을 읽어 PostgREST가 오류를 냈고, 작성자가 잡히는 보고서마다 "선생님을(를) 읽지 못했습니다"로
    //    미리보기가 멈췄다(2026-10-28 · 가짜 DB 시험이 칸을 안 봐서 통과). 시험이 select 칸을 SQL 정의와 대조한다.
    teacherId ? db.from("users").select("display_name, report_notice_mode").eq("tenant_id", tenantId).eq("id", teacherId).maybeSingle() : null,
    // 운영과 같은 읽기(admin · tenant 필터는 함수 안) — 실패·표 없음은 null(말투 없이)이라 운영과 같다.
    teacherId ? loadTeacherMentStyle(createAdminClient(), tenantId, teacherId) : null,
    fetchScoreHistory(db, studentId, subjectKey || undefined, reportDate, 90, { classId, specialClassIds, lookbackDays: TREND_HISTORY_FETCH_DAYS }),
  ]);
  const roster = rosterRes ? (must<PreviewSession[]>(rosterRes, "선생님 명단") ?? []) : own ? [own] : [];
  const teacher = teacherRes ? must(teacherRes, "선생님") : null;

  // 입력 — 화면(buildReportCommentInput)과 같은 칸: 그 행 칸의 메모 · 반 전체 안내 판정은 그 선생님의 그날 명단 전체로.
  const entry = own ? entryOf(own, row) : null;
  const subjectLabel = subjectKey ? buildSubjectMaps(settings.operations.subjects).labelOf(subjectKey) : "";
  const split = splitNoticeFromNote(own ? noteOfEntry(entry, own) : "", classId, detectClassNotices(classNoteRows(roster)));
  // 특강 행이 있는 학생 = 그 반이 특강이거나 작성자 화면의 이 학생 칸에 특강 반이 있다(세션은 화면의 모든 행 칸을 싣는다).
  const specialRow = [classId, ...Object.keys(own?.subject_progress ?? {})].some((k) => !!k && specialClassIds.includes(k));
  const tests = previewTestLines(str(r.exam_info) || null, pickPrior(must<PriorReport[]>(priorRes, "직전 보고서") ?? [], subjectKey, specialRow), {
    daily: str(r.daily_test),
    check: str(r.check_test),
  });
  const videoHomework = typeof r.video_homework === "boolean" ? r.video_homework : undefined;
  const homework = str(r.homework_score);
  const input: ReportCommentInput = {
    studentName,
    subject: subjectLabel,
    progress: stripSubjectLabel(str(r.progress), subjectLabel),
    progressMode: progressModeOf(entry),
    dailyTest: tests.daily,
    checkTest: tests.check,
    attitude: str(r.attitude),
    homework: homework && homework !== "—" ? homework : "",
    homeworkToday: str(r.homework_today),
    ...(videoHomework !== undefined ? { videoHomework } : {}),
    ...(videoHomework === true ? { videoHomeworkDue: homeworkDueText(reportDate, (r.video_homework_due as string | null) ?? null) } : {}),
    textbook: str(r.textbook),
    specialNote: split.specialNote,
    classNotice: split.classNotice,
  };

  // 여기부터 운영(generateReportComment)과 같은 순서 — 학부모께 드리는 말을 떼고, 재료가 없으면 부르지 않는다.
  const noteSplit = splitParentAddress(input.specialNote);
  const noticeSplit = splitParentAddress(input.classNotice);
  const parentAddress = [...noteSplit.address, ...noticeSplit.address];
  const safeInput: ReportCommentInput = { ...input, specialNote: noteSplit.rest, classNotice: noticeSplit.rest, classContext: "" };
  const facts = [safeInput.progress, safeInput.attitude, safeInput.dailyTest, safeInput.checkTest, safeInput.homework, safeInput.homeworkToday, safeInput.specialNote];
  if (!facts.some((v) => v.trim())) return { ok: false, error: "이 보고서엔 멘트 재료(진도·태도·과제·특이사항)가 없습니다 — 다른 보고서를 선택하세요" };

  history.push({ date: reportDate, examInfo: str(r.exam_info) || null, homeworkScore: homework || null, classId });
  const ti = buildTrendInput(history, { today: reportDate });
  const trendInput = ti && ti.facts.length ? ti : null;
  if (type === "trend" && !trendInput) {
    const why = ti?.quiet ? "이 보고서 시점엔 지난 보고서와 달라진 점이 없거나 말할 흐름이 없어 추세를 쓰지 않습니다" : "이 학생은 추세 표본이 부족합니다";
    return { ok: false, error: `${why} — 다른 보고서를 선택하세요` };
  }
  // 고친 프롬프트가 쓰이는 모드로 — 추세는 그 선생님 모드(없으면 학원 기본)로 멘트까지 같이 쓴다.
  const mode: "A" | "B" =
    type === "comment" ? "A" : type === "trend" ? ((teacher?.report_notice_mode as "A" | "B" | null) ?? settings.report.noticeMode ?? "A") : "B";
  const sections = mentSections({
    mode,
    input: safeInput,
    templates,
    styleSeed: `${input.studentName}|${reportDate}|${input.subject}`,
    styleBlock: mentStyle ? mentStyleDirective(mentStyle) : "",
    toneBlock: mentStyle ? mentStyleToneDirective(mentStyle) : "",
    trend: trendInput,
  });
  // 고친 문단이 실제로 들어갔을 때만 — 아니면 고친 프롬프트를 한 번도 안 쓰고 다른 문단만 보여 준다.
  if (!sections.some((s) => s.type === type)) return { ok: false, error: "이 보고서엔 고친 문단의 입력이 없습니다 — 다른 보고서를 선택하세요" };

  const { data, model } = await generateJSON<Record<string, unknown>>({
    prompt: assembleCombined(sections),
    maxTokens: mentMaxTokens(safeInput),
    keyName: "default",
    tier: "fast",
    meta: { feature: "ment_prompt_preview", tenantId },
    ...MENT_AI_TUNING,
  });
  const res = readMentResponse(data, mode, trendInput);
  return {
    ok: true,
    output: formatMentPreview({
      comment: res.comment ? prependParentAddress(appendVideoReceiptComment(res.comment, receipt), parentAddress) : "",
      trend: trendInput ? res : null,
      trendSkipped: trendInput ? null : ti?.quiet ? "quiet" : "sample",
      modelLabel: modelDisplayLabel(model),
      mode,
      hasSpecialNote: !!safeInput.specialNote.trim(),
      hasClassNotice: !!safeInput.classNotice?.trim(),
      styleTeacher: mentStyle && teacher ? str(teacher.display_name) || null : null,
    }),
  };
}
