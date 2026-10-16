import { parseExamMaxes, parseExamScores } from "./exam-info";
import { testLine } from "./report-comment";

/**
 * AI 멘트 탭 미리보기가 저장된 기록에서 **화면과 같은 입력**을 다시 만드는 규칙(순수 · 테스트 대상).
 * 화면 쪽 단일 소스 = roster.ts(세션 칸 찾기) · row-fields.ts(메모 폴백) · report-comment.ts(`testLine`) · roster의 직전 회차 증감.
 * 🔴 미리보기가 다른 재료를 쓰면 거기서 본 글과 실제 글이 달라진다(원장 2026-10-16 미리보기 후속 · 적대적 리뷰).
 */

type Entry = Record<string, unknown>;
export type PreviewSession = {
  class_id: string | null;
  updated_by: string | null;
  subject_progress: Record<string, Entry | null> | null;
  special_note: string | null;
};
export type RowKey = { classId: string | null; makeup: boolean; subjectKey: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 그 행의 세션 칸 — roster.ts와 같은 순서: 반 키 → (보강 행이면) `makeup::과목` → 옛 과목 키(보강 행은 타지 않는다). */
export function entryOf(s: PreviewSession, row: RowKey): Entry | null {
  const sp = s.subject_progress ?? {};
  const makeupKey = row.makeup && !row.classId ? `makeup::${row.subjectKey}` : null;
  const byKey = makeupKey ? sp[makeupKey] : row.classId ? sp[row.classId] : undefined;
  if (byKey) return byKey;
  return makeupKey ? null : (sp[row.subjectKey] ?? null);
}

/** 그 행의 특이사항 — row-fields.ts와 같다: 칸에 `note`가 있으면(비운 것 포함) 그 값, 없을 때만 학생 메모(옛 칸). */
export function noteOfEntry(entry: Entry | null, s: PreviewSession): string {
  if (entry && entry.note !== undefined) return typeof entry.note === "string" ? entry.note : "";
  return s.special_note ?? "";
}

/** 오늘 수업 성격(복습·문제풀이) — 세션 칸의 `mode`(roster.ts). 빈 값 = 해제. */
export function progressModeOf(entry: Entry | null): string | null {
  return typeof entry?.mode === "string" && entry.mode ? entry.mode : null;
}

/** 이 보고서를 쓴 화면 — 보고서 작성자(`created_by`)의 세션 중 그 행 칸이 있는 것 → 그 행 칸이 있는 아무 세션 → 작성자 세션. */
export function pickSession(sessions: readonly PreviewSession[], row: RowKey, createdBy: string | null): PreviewSession | null {
  const withEntry = sessions.filter((s) => entryOf(s, row));
  return (
    withEntry.find((s) => createdBy && s.updated_by === createdBy) ??
    withEntry[0] ??
    sessions.find((s) => createdBy && s.updated_by === createdBy) ??
    null
  );
}

/** 반 전체 안내 판정 재료 — 그 선생님 그날 명단의 **반 칸**만(화면은 반이 없는 행을 판정에서 뺀다). */
export function classNoteRows(roster: readonly PreviewSession[]): { classId: string; note: string }[] {
  return roster.flatMap((s) =>
    Object.keys(s.subject_progress ?? {})
      .filter((k) => UUID.test(k))
      .map((k) => ({ classId: k, note: noteOfEntry(s.subject_progress?.[k] ?? null, s) })),
  );
}

export type PriorReport = { class_id: string | null; subject: string | null; exam_info: string | null };

/**
 * 직전 회차(증감 기준) — 화면(roster.ts)과 같다: **학생 단위**로 같은 과목의 가장 최근 회차(반은 보지 않는다 · 옛 보고서 과목 없음 = 수학).
 * 🔴 그 학생 화면에 특강 행이 하나라도 있으면 증감을 붙이지 않는다(`specialRow` — 정규·특강을 못 가르는 폴백이라 화면이 통째로 끈다).
 */
export function pickPrior(rows: readonly PriorReport[], subjectKey: string, specialRow: boolean): PriorReport | null {
  if (specialRow) return null;
  return rows.find((r) => (r.subject || "math") === (subjectKey || "math")) ?? null;
}

/**
 * 시험 줄 — 화면처럼 `testLine(점수, 만점, 직전 점수)`로 "(지난 회차 대비 ▲N)"까지. 문항 수가 다르면 직전 점수를 버린다(roster.ts).
 * 저장된 문장이 비어 있으면(그 시험을 안 보였거나 안 봄) 그대로 빈 값 · 점수를 못 읽으면 저장된 문장 그대로.
 */
export function previewTestLines(
  examInfo: string | null,
  prior: PriorReport | null,
  saved: { daily: string; check: string },
): { daily: string; check: string } {
  const score = parseExamScores(examInfo);
  const max = parseExamMaxes(examInfo);
  const prevScore = parseExamScores(prior?.exam_info);
  const prevMax = parseExamMaxes(prior?.exam_info);
  const line = (k: "daily" | "check") => {
    if (!saved[k].trim()) return "";
    const s = score[k];
    const m = max[k];
    if (s == null || m == null) return saved[k];
    const prev = prevScore[k] != null && (prevMax[k] == null || prevMax[k] === m) ? prevScore[k] : null;
    return testLine(s, m, prev);
  };
  return { daily: line("daily"), check: line("check") };
}
