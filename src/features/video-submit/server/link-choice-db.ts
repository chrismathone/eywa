import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { assignmentKey } from "@/features/video-homework/assignment";
import { reportLineMode, type SubmitLinkChoices, type SubmitLinkMode } from "../link-choice";
import { videoSubmitAvailability } from "./availability";

type Db = ReturnType<typeof createAdminClient>;

/**
 * `lesson_reports.video_submit_link`(0328a) 적용 여부 — 셋으로 가른다.
 *  · ready   = 칸이 있다(양성만 기억 — 칸은 생기기만 한다).
 *  · missing = 칸이 아직 없다(SQL 적용 전, #95) → 토글을 안 그리고 링크는 예전 규칙대로.
 *  · unknown = 못 물어봤다(일시 오류) → 🔴 **missing으로 읽지 말 것**: 예전 규칙으로 떨어지면 강사가 끈 링크가 붙는다.
 */
export type LinkColumnState = "ready" | "missing" | "unknown";
let columnKnownReady = false;

export async function videoSubmitLinkColumn(db: Db = createAdminClient()): Promise<LinkColumnState> {
  if (columnKnownReady) return "ready";
  const { error } = await db.from("lesson_reports").select("video_submit_link").limit(1);
  if (!error) {
    columnKnownReady = true;
    return "ready";
  }
  const message = error.message ?? "";
  if (/video_submit_link/.test(message) && /(does not exist|column|schema cache)/i.test(message)) return "missing";
  console.warn(JSON.stringify({ level: "warn", scope: "videoSubmitLinkColumn", reason: "probe_failed_transient", message }));
  return "unknown";
}

/** 테스트 전용 — 모듈 캐시 리셋. */
export function _resetVideoSubmitLinkColumnForTest(): void {
  columnKnownReady = false;
}

/** 원스크린에 내려 줄 것 — 토글을 그릴 단계(off면 안 그린다)와 그날 이미 저장된 고르기. */
export type SubmitLinkUi = { mode: SubmitLinkMode; choices: SubmitLinkChoices };
const OFF: SubmitLinkUi = { mode: "off", choices: {} };
type ChoiceRow = { student_id: string; class_id: string | null; video_submit_link: boolean | null };

/**
 * 원스크린용 — '영상 첨부 링크 넣기' 토글을 그릴 수 있나 + 그날 저장된 고르기(`학생|날짜|반 → true/false`).
 * 🔴 전원 핫패스다(#95) — 어떤 실패도 `off`로 떨어진다: 토글이 안 보이고, 화면은 이 값을 **보내지 않아** 저장돼 있던 고르기를 덮지 않는다.
 * 줄이 실제로 붙을 수 있을 때만 켠다(단계 env · 칸 있음 · 지점 기능·Drive·링크 표 — 발송 직전 판정과 같은 재료).
 */
export async function getSubmitLinkUi(tenantId: string, studentIds: string[], date: string): Promise<SubmitLinkUi> {
  const mode = reportLineMode();
  if (mode === "off") return OFF;
  try {
    const db = createAdminClient();
    if ((await videoSubmitLinkColumn(db)) !== "ready") return OFF;
    const ids = [...new Set(studentIds)];
    const [availability, rows] = await Promise.all([
      getTenantSettingsByTenantId(tenantId).then((settings) => videoSubmitAvailability(tenantId, settings, db)),
      ids.length
        ? fetchAllPagedInChunks<ChoiceRow>(ids, (chunk, from, to) => db
            .from("lesson_reports")
            .select("student_id,class_id,video_submit_link")
            .eq("tenant_id", tenantId)
            .in("student_id", chunk)
            .eq("report_date", date)
            .not("video_submit_link", "is", null)
            .order("id", { ascending: true })
            .range(from, to))
        : Promise.resolve([] as ChoiceRow[]),
    ]);
    if (!availability.ok) return OFF;
    const choices: Record<string, boolean> = {};
    for (const row of rows) {
      if (!row.class_id || typeof row.video_submit_link !== "boolean") continue;
      choices[assignmentKey(row.student_id, date, row.class_id)] = row.video_submit_link;
    }
    return { mode, choices };
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", scope: "getSubmitLinkUi", message: e instanceof Error ? e.message : String(e) }));
    return OFF;
  }
}
