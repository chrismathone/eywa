import "server-only";
/**
 * 업무 비서 AI 정리 — 사람이 누를 때(`askSecretary`)와 예약 시각(`secretary-schedule.ts`)에만 AI를 부르고(페이지 로드는 부르지 않는다),
 * 그날의 정리를 남긴다. 화면은 숫자가 바뀔 때 마지막 후보만 남긴다(`captureSecretaryInput` — AI 호출 없음).
 * 표(s2_0019)는 RLS 정책 0 — 서버 키로 읽고 쓰되 지점 · 본인을 늘 함께 거른다([[#104]]). 표가 없으면 버튼째 없다(#95).
 * 사람은 할 일과 같은 문(`getStaffTaskViewer`) · 업무를 요청할 수 있는 사람(`canCreateWork`)만. AI가 꺼진 지점(`ai_analysis`)은 버튼 · 정리 · 후보째 없다.
 * 🔴 정리 줄 = 모델 칸이 있는 줄. AI를 부르기 직전에 모델 칸이 빈 '시도 표식'을 먼저 남긴다 — 실패한 실행도 30초 · 하루 제한에 들고,
 *    두 창 · 겹친 예약이 같은 사람에게 동시에 돌면 늦게 남긴 쪽이 물러난다. 성공하면 그 줄이 정리가 된다.
 */
import { generateJSON } from "@/lib/ai/generate";
import { kstToday } from "@/lib/date-kst";
import { isFeatureLicensed } from "@/lib/license/server";
import { LICENSE_BLOCKED_MESSAGE } from "@/lib/license/rule";
import { createAdminClient } from "@/lib/supabase/admin";
import { explainDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import type { StaffTaskViewer } from "@/features/staff-tasks/server/gate";
import { canCreateWork } from "@/features/work-requests/server/board";
import { buildSecretaryPrompt, groundSecretary, type AsOf, type RunKind, type SecretaryInput, type SecretaryNote, type SecretaryRun } from "./secretary-ai";
import type { SecretaryPlan } from "./secretary-plan";

export const NOTES = "dashboard_secretary_notes";
export const INPUTS = "dashboard_secretary_inputs";
/** 같은 사람이 연달아 누르지 않게(30초) · 하루 상한 — 실패한 시도도 센다. */
const GAP_MS = 30_000;
const DAY_MAX = 30;
/** 예약이 같은 사람에게 겹쳐 돌았나 보는 창(예약 쪽 `REPEAT_MS`와 같은 값). */
export const SCHEDULE_REPEAT_MS = 3 * 3_600_000;
/** 아직 도는 시도로 보는 시간 — 이 안의 '진행 중' 표식이 있으면 종류(버튼 · 예약)와 상관없이 물러난다. 넘으면 멈춘 시도로 본다. */
const RUNNING_MS = 2 * 60_000;
const COLUMNS = "created_at, model, input, result, run_kind, basis_at";

export const isMissingSecretaryTable = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703" || (/dashboard_secretary/.test(error.message ?? "") && /does not exist|schema cache/.test(error.message ?? "")));

type Row = { created_at: string; model: string | null; input: SecretaryInput; result: { plan: SecretaryPlan; replaced?: number }; run_kind: RunKind | null; basis_at: string | null };
const noteOf = (row: Row): SecretaryNote => ({
  at: row.created_at, model: row.model, plan: row.result.plan, replaced: row.result.replaced ?? 0, runKind: row.run_kind ?? "button", basisAt: row.basis_at,
  counts: Object.fromEntries(row.input.candidates.map((c) => [c.ref, c.count])),
});

export type SecretaryState = { enabled: boolean; note: SecretaryNote | null; runs: SecretaryRun[] };
/** 실패 — `called` = AI를 부른 뒤의 실패(감사로그에 남긴다) · `model` = 답한 모델(알면). */
export type AskResult = { ok: true; note: SecretaryNote } | { ok: false; error: string; status: number; called?: boolean; model?: string | null };
const OFF: SecretaryState = { enabled: false, note: null, runs: [] };
const aiOn = (tenantId: string) => isFeatureLicensed(tenantId, "ai_analysis");

/** 오늘(KST) 내가 받은 마지막 정리와 오늘 돌린 시각들 — 마지막 한 줄만 통째로, 나머지는 시각 · 종류만 읽는다. */
export async function loadSecretaryNote(viewer: StaffTaskViewer): Promise<SecretaryState> {
  if (!canCreateWork(viewer) || !(await aiOn(viewer.user.tenantId))) return OFF;
  // 오늘 내 정리(모델 칸이 있는 줄 — 시도 표식은 뺀다).
  const today = (columns: string) => createAdminClient().from(NOTES).select(columns).eq("tenant_id", viewer.user.tenantId).eq("user_id", viewer.user.id)
    .eq("for_date", kstToday()).not("model", "is", null).order("created_at", { ascending: false });
  const [runs, last] = await Promise.all([today("created_at, run_kind").limit(DAY_MAX + 4), today(COLUMNS).limit(1).maybeSingle()]);
  const error = runs.error ?? last.error;
  if (error) {
    if (isMissingSecretaryTable(error)) return OFF;
    throw new Error(explainDbError(error, { scope: "dashboard-secretary.load", fallback: "업무 비서 정리를 불러오지 못했습니다" }).message);
  }
  // 고르는 칸을 글자로 넘겨 행 모양을 추론하지 못한다 — 읽은 칸 그대로 적는다.
  const times = (runs.data ?? []) as unknown as { created_at: string; run_kind: RunKind | null }[];
  return { enabled: true, note: last.data ? noteOf(last.data as unknown as Row) : null, runs: times.map((r) => ({ at: r.created_at, runKind: r.run_kind ?? "button" })).reverse() };
}

/** 마지막 후보 남기기 — 예약 정리가 읽는다(AI 호출 없음 · 사람마다 한 줄). AI가 꺼진 지점은 남기지 않는다(예약이 돌 일이 없다). */
export async function captureSecretaryInput(viewer: StaffTaskViewer, input: SecretaryInput): Promise<{ ok: boolean }> {
  if (!canCreateWork(viewer) || input.today !== kstToday() || !(await aiOn(viewer.user.tenantId))) return { ok: false };
  const { error } = await createAdminClient().from(INPUTS)
    .upsert({ tenant_id: viewer.user.tenantId, user_id: viewer.user.id, input, captured_at: new Date().toISOString() }, { onConflict: "tenant_id,user_id" });
  if (error && !isMissingSecretaryTable(error)) throw new Error(explainDbError(error, { scope: "dashboard-secretary.capture", fallback: "후보를 남기지 못했습니다" }).message);
  return { ok: !error };
}

type RunArgs = { tenantId: string; userId: string; input: SecretaryInput; runKind: RunKind; basisAt: string; asOf?: AsOf };
const saveFail = (error: unknown, fallback: string): AskResult => ({ ok: false, error: explainDbError(error, { scope: "dashboard-secretary.save", fallback }).message, status: 500 });

/**
 * 시도 표식 남기기 — 먼저 남긴 줄이 있으면 물러난다(남긴 표식은 지운다): 같은 종류가 창 안에(버튼 30초 · 예약 3시간) 있거나,
 * 종류와 상관없이 아직 도는 시도가 2분 안에 있을 때(12:59 버튼과 13:00 예약 · AI가 30초를 넘긴 버튼에 다른 창이 누른 것).
 */
async function claim(args: RunArgs): Promise<{ id: number } | AskResult> {
  const admin = createAdminClient();
  const made = await admin.from(NOTES)
    .insert({ tenant_id: args.tenantId, user_id: args.userId, for_date: kstToday(), model: null, input: args.input, result: { pending: true }, run_kind: args.runKind, basis_at: args.basisAt })
    .select("id, created_at").single();
  if (made.error || !made.data) return isMissingSecretaryTable(made.error) ? { ok: false, error: "업무 비서를 아직 쓸 수 없습니다", status: 503 } : saveFail(made.error, "정리를 시작하지 못했습니다. 잠시 뒤 다시 눌러 주세요");
  const { id, created_at } = made.data as { id: number; created_at: string };
  const since = (ms: number) => new Date(Date.parse(created_at) - ms).toISOString();
  const [sameKind, running] = await Promise.all([
    admin.from(NOTES).select("id", { count: "exact", head: true }).eq("tenant_id", args.tenantId).eq("user_id", args.userId).lt("id", id)
      .eq("run_kind", args.runKind).gte("created_at", since(args.runKind === "schedule" ? SCHEDULE_REPEAT_MS : GAP_MS)),
    admin.from(NOTES).select("result").eq("tenant_id", args.tenantId).eq("user_id", args.userId).lt("id", id).is("model", null).gte("created_at", since(RUNNING_MS)),
  ]);
  const error = sameKind.error ?? running.error;
  const busy = (sameKind.count ?? 0) > 0 || ((running.data ?? []) as { result: { pending?: boolean } | null }[]).some((r) => r.result?.pending === true);
  if (error || busy) {
    await admin.from(NOTES).delete().eq("id", id);
    return error ? saveFail(error, "잠시 뒤 다시 눌러 주세요") : { ok: false, error: "방금 시작한 정리가 아직 진행 중입니다. 잠시 뒤 다시 보세요", status: 429 };
  }
  return { id };
}

/** AI 정리 한 번 — 버튼 · 예약이 같은 길을 지난다(시도 표식 · 프롬프트 · 후검증 · 저장). */
export async function runSecretary(args: RunArgs): Promise<AskResult> {
  const claimed = await claim(args);
  if (!("id" in claimed)) return claimed;
  const admin = createAdminClient();
  const fail = (reason: string) => admin.from(NOTES).update({ result: { failed: reason } }).eq("id", claimed.id);
  let answer: { data: unknown; model: string };
  try {
    answer = await generateJSON({
      prompt: buildSecretaryPrompt(args.input, args.asOf),
      maxTokens: 4000,
      // 사람이 화면에서 기다린다 — 깊은 추론보다 빠른 답(후보 순서 · 이유만 쓰는 일이다).
      reasoningEffort: "medium",
      meta: { tenantId: args.tenantId, feature: "dashboard_secretary" },
    });
  } catch (error) {
    await fail("error");
    throw error;
  }
  const grounded = groundSecretary(answer.data, args.input);
  if (!grounded) {
    await fail("ungrounded");
    return { ok: false, error: "AI 정리가 자료와 맞지 않아 쓰지 않았습니다. 자동 정리를 보세요", status: 422, called: true, model: answer.model };
  }
  const saved = await admin.from(NOTES).update({ model: answer.model, result: grounded }).eq("id", claimed.id).select(COLUMNS).single();
  if (saved.error || !saved.data) return { ...saveFail(saved.error, "정리를 남기지 못했습니다. 잠시 뒤 다시 눌러 주세요"), called: true, model: answer.model };
  return { ok: true, note: noteOf(saved.data as Row) };
}

/** 'AI로 정리' 버튼 — 지금 화면의 후보로. 같은 사람 30초 · 하루 30번까지(실패한 시도 포함). */
export async function askSecretary(viewer: StaffTaskViewer, input: SecretaryInput): Promise<AskResult> {
  if (!canCreateWork(viewer)) return { ok: false, error: "업무 비서는 업무를 요청할 수 있는 사람이 씁니다", status: 403 };
  const tenantId = viewer.user.tenantId;
  if (!(await aiOn(tenantId))) return { ok: false, error: LICENSE_BLOCKED_MESSAGE.ai_analysis, status: 403 };
  const today = kstToday();
  if (input.today !== today) return { ok: false, error: "날짜가 바뀌었습니다. 화면을 새로고침한 뒤 다시 눌러 주세요", status: 409 };
  const recent = await createAdminClient().from(NOTES).select("created_at").eq("tenant_id", tenantId).eq("user_id", viewer.user.id).eq("for_date", today)
    .eq("run_kind", "button").order("created_at", { ascending: false }).limit(DAY_MAX);
  if (recent.error) {
    if (isMissingSecretaryTable(recent.error)) return { ok: false, error: "업무 비서를 아직 쓸 수 없습니다", status: 503 };
    return { ok: false, error: explainDbError(recent.error, { scope: "dashboard-secretary.recent", fallback: "잠시 뒤 다시 눌러 주세요" }).message, status: 500 };
  }
  const rows = recent.data ?? [];
  if (rows.length >= DAY_MAX) return { ok: false, error: `오늘은 더 정리할 수 없습니다(하루 ${DAY_MAX}번)`, status: 429 };
  if (rows[0] && Date.now() - Date.parse(rows[0].created_at as string) < GAP_MS) return { ok: false, error: "방금 정리했습니다. 잠시 뒤 다시 눌러 주세요", status: 429 };
  await captureSecretaryInput(viewer, input).catch(() => undefined); // 예약 정리도 이 후보를 쓴다
  // 감사로그 — 사람이 눌러 유료 AI를 태운 시도마다(AI를 부른 뒤 끝난 것 · 성공 · 자료와 안 맞음 · 오류 — `briefing_regenerate`와 같은 결).
  const audit = (outcome: "ok" | "mismatch" | "error", model: string | null) =>
    logAction({ action: "dashboard_secretary_run", targetType: "dashboard_secretary", targetLabel: null, metadata: { candidates: input.candidates.length, model, outcome } });
  let result: AskResult;
  try {
    result = await runSecretary({ tenantId, userId: viewer.user.id, input, runKind: "button", basisAt: new Date().toISOString() });
  } catch (error) {
    await audit("error", null);
    throw error;
  }
  if (result.ok) await audit("ok", result.note.model);
  else if (result.called) await audit(result.status === 422 ? "mismatch" : "error", result.model ?? null);
  return result;
}
