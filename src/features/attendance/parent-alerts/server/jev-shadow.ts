import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateJSON } from "@/lib/ai/generate";
import { kstToday } from "@/lib/date-kst";
import { ATTENDANCE_RUBRIC_VERSION, attendanceDecisionSchema, buildAttendanceDecision, attendanceReviewReasons } from "../jev-decision";

export const shadowRequestSchema = z.object({
  tenantId: z.uuid(), messageId: z.uuid(),
  // Board names are not authoritative course metadata; reviewer explicitly specifies the target.
  course: z.string().trim().min(1).max(40), targetDate: z.iso.date().optional(),
}).strict();
export type ShadowRequest = z.infer<typeof shadowRequestSchema>;
export class ShadowError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type MessageRow = {
  id: string; tenant_id: string; student_id: string | null; child_id: number | null;
  classnote_post_id: number; content: string; posted_at: string | null; created_at: string;
  category: string | null; starts_on: string | null; ends_on: string | null; model: string | null;
};
const COLUMNS = "id, tenant_id, student_id, child_id, classnote_post_id, content, posted_at, created_at, category, starts_on, ends_on, model";
const at = (row: MessageRow) => Date.parse(row.posted_at ?? row.created_at);

/** Explicitly requested snapshot only. This module never imports a sender or writes classification rows. */
export async function compareParentMessageWithJev(raw: ShadowRequest) {
  const request = shadowRequestSchema.parse(raw);
  const enabled = (process.env.CLASSNOTE_JEV_SHADOW_TENANT_IDS ?? "").split(",").map((id) => id.trim()).includes(request.tenantId);
  if (!enabled) throw new ShadowError("Jev 비교가 활성화되지 않은 지점입니다", 403);
  const db = createAdminClient();
  const { data: focus, error } = await db.from("classnote_parent_messages").select(COLUMNS)
    .eq("tenant_id", request.tenantId).eq("id", request.messageId).maybeSingle();
  if (error) throw new ShadowError("비교할 연락 조회 실패", 503);
  if (!focus) throw new ShadowError("비교할 연락이 없습니다", 404);
  const row = focus as MessageRow;
  if (!row.student_id) throw new ShadowError("학생 매핑을 먼저 확인해야 합니다", 422);
  const { data: student, error: studentError } = await db.from("students").select("id, name")
    .eq("tenant_id", request.tenantId).eq("id", row.student_id).maybeSingle();
  if (studentError) throw new ShadowError("학생 조회 실패", 503);
  if (!student?.name) throw new ShadowError("지점의 학생 매핑을 확인할 수 없습니다", 422);

  let history: MessageRow[] = [];
  if (row.child_id != null) {
    // Same tenant + post + child + student. Never mix sibling/family/group-board threads.
    const { data, error: historyError } = await db.from("classnote_parent_messages").select(COLUMNS)
      .eq("tenant_id", request.tenantId).eq("classnote_post_id", row.classnote_post_id)
      .eq("child_id", row.child_id).eq("student_id", row.student_id)
      .order("created_at", { ascending: true }).limit(42);
    if (historyError) throw new ShadowError("앞선 연락 조회 실패", 503);
    // Do not silently drop an earlier correction to fit the model's input budget.
    if ((data?.length ?? 0) > 41) throw new ShadowError("대화가 길어 수동 검토가 필요합니다", 422);
    const thread = (data ?? []) as MessageRow[];
    if (![row, ...thread].every((m) => Number.isFinite(at(m)))) throw new ShadowError("연락 시각 확인이 필요합니다", 422);
    // Equal timestamps have no trustworthy conversational ordering; refuse ambiguous snapshots.
    if (thread.some((m) => m.id !== row.id && at(m) === at(row))) throw new ShadowError("동일 시각 연락의 순서 확인이 필요합니다", 422);
    history = thread.filter((m) => m.id !== row.id && at(m) < at(row)).sort((a, b) => at(a) - at(b));
    if (history.some((m, i) => i > 0 && at(m) === at(history[i - 1]))) throw new ShadowError("앞선 연락의 순서 확인이 필요합니다", 422);
  }
  if (!Number.isFinite(at(row))) throw new ShadowError("연락 시각 확인이 필요합니다", 422);
  const dated = (m: MessageRow) => ({ date: kstToday(new Date(at(m))), content: m.content });
  const parsed = attendanceDecisionSchema.safeParse({
    studentName: student.name, course: request.course, targetDate: request.targetDate ?? dated(row).date,
    latest: dated(row), history: history.map(dated),
  });
  if (!parsed.success) throw new ShadowError("본문 길이·날짜·학생 정보를 수동 검토해야 합니다", 422);
  const decision = buildAttendanceDecision(parsed.data);
  const inputHash = createHash("sha256").update(JSON.stringify({ rubric: ATTENDANCE_RUBRIC_VERSION, ...decision })).digest("hex");
  const result = await generateJSON({
    mode: "decision", ...decision,
    meta: { tenantId: request.tenantId, feature: "parent_attendance_jev_shadow" },
  });
  const answer = result.data.attendance;
  const reviewReasons = attendanceReviewReasons(answer, history.length);
  if (row.child_id == null) reviewReasons.push("child_mapping_missing");
  // Stored classifier saw only the latest message and can span several days. Agreement is diagnostic,
  // not accuracy: different context / dates are intentionally reported as incomparable.
  const comparable = history.length === 0 && (
    row.category === "none" ? parsed.data.targetDate === parsed.data.latest.date
      : !!row.starts_on && !!row.ends_on && row.starts_on <= parsed.data.targetDate && row.ends_on >= parsed.data.targetDate
  );
  return {
    mode: "shadow" as const, canNotify: false as const, messageId: row.id,
    targetDate: parsed.data.targetDate, rubricVersion: ATTENDANCE_RUBRIC_VERSION, inputHash,
    prediction: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities,
    reviewReasons, historyCount: history.length, historyScope: "same_post_child_student" as const,
    baseline: { category: row.category, startsOn: row.starts_on, endsOn: row.ends_on, model: row.model },
    categoryAgreement: comparable && row.category ? row.category === answer.choice : null,
    model: result.model, elapsedMs: result.elapsedMs, usage: result.usage,
  };
}
