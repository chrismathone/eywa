"use server";

/**
 * 사랑의 한마디 **초안** 서버 액션 — 원스크린 사랑의 한마디 칸 옆 [초안] 버튼(원장 2026-10-28).
 *
 * 문지기는 수학 멘트(`generateReportComment`)와 같다: 로그인 · '다른 강사 뷰'(열람 전용) 차단 · 그날 사실이 하나도 없으면 AI를 부르지 않는다.
 * 보고서는 바꾸지 않는다 — 글을 돌려주면 화면이 칸에 넣고, 선생님이 고쳐서 보낸다.
 * 재료(전부 admin + tenant_id — 남의 지점 글을 섞지 않는다):
 *  ① 이 강사가 보낸 한마디 최근 40개(말투 예시 · 학생 이름 가림) — 강사 = 화면의 강사 스코프(`effectiveTeacherId`, 말투 프로파일과 같다).
 *     관리자 뷰(스코프 없음)는 예시 없이 쓴다 — 그 글은 다른 강사 이름으로 나가는 보고서다.
 *  ② 이 학생에게 최근 보낸 한마디 5개(누가 썼든) — 되풀이 금지(원장 2026-10-26 매크로성 반복 금지).
 *  ③ 지난 초안(s2_0002 `love_note_suggestions`) ↔ 실제로 보낸 한마디 — 선생님이 **고친** 쌍 10개(고치는 습관).
 * 🔴 AI는 버튼을 누를 때만(페이지 로드·자동작성에서 부르지 않는다 — CLAUDE.md 'AI 호출은 명시적 트리거').
 * ⚠️ 표가 아직 없으면(SQL 미적용) ③과 기록만 건너뛴다([[#95]]).
 * ⚠️ 이 파일은 async 함수만 export한다([[#119]]).
 */
import { isMissingRelation } from "@/lib/supabase/db-error";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { generateJSON } from "@/lib/ai/generate";
import { aiUserMessage } from "@/lib/ai/user-message";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { resolveReportDate } from "@/lib/date-kst";
import { reportError, reportWarning } from "@/lib/observability/report-error";
import { MENT_AI_TUNING } from "../prompt-defaults";
import {
  LOVE_NOTE_HEAD,
  buildLoveNotePrompt,
  checkLoveNote,
  extractLoveNote,
  hasLoveNoteFacts,
  maskNames,
  pairLoveNoteEdits,
  parseLoveNote,
  sanitizeLoveNoteFacts,
  type LoveNoteFinalRow,
  type LoveNoteSuggestionRow,
} from "../love-note";

export type SuggestLoveNoteInput = {
  studentId: string;
  studentName: string;
  subject: string;
  /** 보고서 날짜(빈 값 = 오늘). */
  reportDate?: string;
  facts: unknown;
};

const EXAMPLES = 40;
const RECENT_TO_STUDENT = 5;
const SUGGESTIONS = 20;

// 표 이름 + 없음 코드 둘 다(공용 판정, P1-E) — 예전엔 이름만 봐서 권한·유니크 오류도 "표 없음"으로 삼켰다.
const isMissingTable = (e: unknown) => isMissingRelation(e, "love_note_suggestions");

export async function suggestLoveNote(input: SuggestLoveNoteInput): Promise<{ ok: true; note: string } | { ok: false; error: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // '다른 강사 뷰'(열람 전용) — DB는 안 바꾸지만 AI 호출(비용)이라 열람에서 못 누르게 한다(수학 멘트와 같다).
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };

  const studentId = typeof input.studentId === "string" ? input.studentId.trim() : "";
  const studentName = typeof input.studentName === "string" ? input.studentName.trim().slice(0, 40) : "";
  const subject = typeof input.subject === "string" ? input.subject.trim().slice(0, 40) : "";
  if (!studentId || !studentName || !subject) return { ok: false, error: "학생 정보를 알 수 없습니다" };
  const facts = sanitizeLoveNoteFacts(input.facts);
  // 재료 없이 부르면 응원 문구를 지어낸다 — 그날 값이 하나도 없으면 부르지 않는다.
  if (!hasLoveNoteFacts(facts)) return { ok: false, error: "태도·테스트·숙제·진도 중 하나를 입력한 뒤 초안을 만들 수 있습니다" };
  const reportDate = resolveReportDate(input.reportDate);

  const admin = createAdminClient();
  const tenantId = user.tenantId;
  try {
    const teacherId = await effectiveTeacherId();
    // 학생이 이 지점 학생인지 — 남의 지점 학생 id로 그 학생 글을 읽지 않게.
    const { data: me, error: meErr } = await admin.from("students").select("id").eq("tenant_id", tenantId).eq("id", studentId).maybeSingle();
    if (meErr) throw meErr;
    if (!me) return { ok: false, error: "학생 정보를 알 수 없습니다" };

    // ①②③은 서로 독립(B4).
    const [teacherRows, studentRows, suggestions] = await Promise.all([
      teacherId
        ? admin
            .from("lesson_reports")
            .select("student_id, notes")
            .eq("tenant_id", tenantId)
            .eq("created_by", teacherId)
            .like("notes", `%${LOVE_NOTE_HEAD}%`)
            .order("created_at", { ascending: false })
            .limit(EXAMPLES * 2)
            .then(({ data, error }) => {
              if (error) throw error;
              return (data ?? []) as { student_id: string | null; notes: string | null }[];
            })
        : Promise.resolve([] as { student_id: string | null; notes: string | null }[]),
      admin
        .from("lesson_reports")
        .select("notes, report_date")
        .eq("tenant_id", tenantId)
        .eq("student_id", studentId)
        .neq("report_date", reportDate)
        .like("notes", `%${LOVE_NOTE_HEAD}%`)
        .order("report_date", { ascending: false })
        .limit(RECENT_TO_STUDENT * 2)
        .then(({ data, error }) => {
          if (error) throw error;
          return (data ?? []) as { notes: string | null }[];
        }),
      teacherId ? loadSuggestions(admin, tenantId, teacherId) : Promise.resolve([] as LoveNoteSuggestionRow[]),
    ]);

    // 고친 쌍 — 초안을 만든 날의 실제 보고서(같은 학생·날짜·과목).
    const finals = await loadFinals(admin, tenantId, suggestions);
    // 가릴 이름 — 예시·쌍에 나온 학생들(이 학생 포함 — 예시 속 이 학생도 '○○'로 둔다: 이름은 프롬프트가 따로 준다).
    const nameIds = [...new Set([...teacherRows.map((r) => r.student_id), ...suggestions.map((s) => s.studentId)].filter((v): v is string => !!v))];
    const nameRows = await fetchInChunks(nameIds, (chunk) => admin.from("students").select("id, name").eq("tenant_id", tenantId).in("id", chunk));
    const names = [...new Set([studentName, ...nameRows.map((r) => (r.name as string | null) ?? "").filter(Boolean)])];

    const examples = [
      ...new Set(
        teacherRows
          .map((r) => extractLoveNote(r.notes))
          .filter((v): v is string => !!v)
          .map((v) => maskNames(v, names).slice(0, 300)),
      ),
    ].slice(0, EXAMPLES);
    const recentToStudent = studentRows
      .map((r) => extractLoveNote(r.notes))
      .filter((v): v is string => !!v)
      .slice(0, RECENT_TO_STUDENT)
      .map((v) => v.slice(0, 300));
    const editPairs = pairLoveNoteEdits(suggestions, finals).map((p) => ({
      ai: maskNames(p.ai, names).slice(0, 300),
      sent: maskNames(p.sent, names).slice(0, 300),
    }));

    const { data } = await generateJSON<Record<string, unknown>>({
      prompt: buildLoveNotePrompt({ studentName, facts, examples, recentToStudent, editPairs }),
      maxTokens: 800,
      keyName: "default",
      tier: "fast",
      meta: { feature: "love_note_draft", tenantId },
      ...MENT_AI_TUNING,
    });
    const note = parseLoveNote(data);
    if (!note) return { ok: false, error: "초안을 만들지 못했습니다 — 다시 누르거나 직접 적어 주세요" };
    const check = checkLoveNote(note, { facts, studentName, otherNames: names.filter((n) => n !== studentName) });
    if (!check.ok) {
      reportWarning("사랑의 한마디 초안이 검사에 걸려 쓰지 않음", { scope: "suggestLoveNote", reason: check.reason });
      return { ok: false, error: "초안에 확인되지 않은 내용이 섞여 쓰지 않았습니다 — 다시 누르거나 직접 적어 주세요" };
    }

    // 다음 초안이 '고친 방식'을 배우도록 이 초안을 남긴다 — 응답 뒤에. 표가 없으면 조용히 건너뛴다.
    after(async () => {
      const now = new Date().toISOString();
      const { error } = await admin.from("love_note_suggestions").upsert(
        { tenant_id: tenantId, teacher_id: teacherId, student_id: studentId, report_date: reportDate, subject, ai_note: note, updated_at: now },
        { onConflict: "tenant_id,student_id,report_date,subject" },
      );
      if (error && !isMissingTable(error)) reportWarning("사랑의 한마디 초안 기록 실패", { scope: "suggestLoveNote", message: error.message });
    });
    return { ok: true, note };
  } catch (e) {
    reportError(e, { scope: "suggestLoveNote" });
    return { ok: false, error: aiUserMessage(e, "초안을 만들지 못했습니다 — 잠시 뒤 다시 눌러 주세요") };
  }
}

async function loadSuggestions(admin: ReturnType<typeof createAdminClient>, tenantId: string, teacherId: string): Promise<LoveNoteSuggestionRow[]> {
  const { data, error } = await admin
    .from("love_note_suggestions")
    .select("student_id, report_date, subject, ai_note")
    .eq("tenant_id", tenantId)
    .eq("teacher_id", teacherId)
    .order("updated_at", { ascending: false })
    .limit(SUGGESTIONS);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return (data ?? []).map((r) => ({
    studentId: r.student_id as string,
    reportDate: r.report_date as string,
    subject: r.subject as string,
    aiNote: r.ai_note as string,
  }));
}

/** 초안을 만든 칸의 실제 보고서 — 학생 id로 좁혀 읽고 날짜·과목은 여기서 맞춘다(초안 20줄이라 작다). */
async function loadFinals(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  suggestions: readonly LoveNoteSuggestionRow[],
): Promise<LoveNoteFinalRow[]> {
  if (!suggestions.length) return [];
  const ids = [...new Set(suggestions.map((s) => s.studentId))];
  const dates = [...new Set(suggestions.map((s) => s.reportDate))];
  const rows = await fetchInChunks(ids, (chunk) =>
    admin
      .from("lesson_reports")
      .select("student_id, report_date, subject, notes")
      .eq("tenant_id", tenantId)
      .in("student_id", chunk)
      .in("report_date", dates),
  );
  return rows.map((r) => ({
    studentId: r.student_id as string,
    reportDate: r.report_date as string,
    subject: (r.subject as string | null) ?? "",
    note: extractLoveNote(r.notes as string | null),
  }));
}
