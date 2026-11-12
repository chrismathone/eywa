import "server-only";
import { getTranscript, submitTranscript, type AssemblyTranscript } from "@/lib/ai/assemblyai";
import { getAssemblyaiWebhookUrl } from "@/lib/config/app-url";
import { reportWarning } from "@/lib/observability/report-error";
import { REVIEW_BUCKET } from "../storage-paths";
import { REVIEW_COLUMNS, aiAnalysisEnabled, claimRows, db, errorText, failOrRetry, moveStage, type ReviewRow } from "./rows";

/** 말한 단어가 이보다 적으면 판정할 말이 없는 영상(업로드 화면만 찍은 영상 등)으로 본다. */
const MIN_WORDS = 5;
const SIGNED_URL_TTL_SEC = 6 * 3600;

/**
 * transcribe 단계의 줄을 AssemblyAI(universal-2, ko)에 맡긴다 — 웹훅으로 돌아온다. 전사는 영상당 한 번뿐이다.
 * 🔴 보내기 전에 transcribing으로 선점한다(cron이 겹쳐도 한 번만 낸다). 선점 뒤 전사 번호가 없으면 안전망이 되돌린다.
 */
export async function submitTranscriptions(tenantId: string, limit = 20): Promise<number> {
  if (!(await aiAnalysisEnabled(tenantId))) return 0;
  const { token, rows } = await claimRows(tenantId, "transcribe", "transcribing", limit);
  let sent = 0;
  for (const row of rows) {
    try {
      if (!row.assets?.audioPath) throw new Error("소리 파일 경로가 없습니다");
      const signed = await db().storage.from(REVIEW_BUCKET).createSignedUrl(row.assets.audioPath, SIGNED_URL_TTL_SEC);
      if (signed.error || !signed.data?.signedUrl) throw new Error("소리 파일 주소를 만들지 못했습니다");
      const secret = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
      const job = await submitTranscript({
        audioUrl: signed.data.signedUrl,
        webhookUrl: getAssemblyaiWebhookUrl(),
        webhookAuthHeader: secret ? { name: "x-eywa-webhook-secret", value: secret } : undefined,
        wordBoost: null,
        speakerLabels: false,
      });
      if (await moveStage(row, "transcribing", { transcript_id: job.id, error: null, lock_token: null, locked_at: null }, { lock_token: token })) sent++;
    } catch (e) {
      await failOrRetry(row, "transcribe", `전사 요청 실패: ${errorText(e)}`, 3, { lock_token: token });
    }
  }
  return sent;
}

/** 끝난 전사를 줄에 넣는다 — 말이 거의 없으면 건너뜀(skipped), 전사 자체가 실패면 다시 맡기거나 실패로. */
export async function applyTranscript(row: ReviewRow, t: AssemblyTranscript): Promise<void> {
  const match = { transcript_id: t.id };
  if (t.status === "error") return failOrRetry(row, "transcribe", `전사 실패: ${t.error ?? "알 수 없는 오류"}`, 3, match);
  if (t.status !== "completed") return;
  const words = (t.words ?? []).map((w) => [w.start, w.text] as [number, string]);
  const transcript = { text: t.text ?? "", words, model: t.speech_model_used ?? null };
  if (words.length < MIN_WORDS) {
    await moveStage(row, "transcribing", { stage: "skipped", transcript, error: "말소리가 거의 없어 판정하지 않았습니다", done_at: new Date().toISOString() }, match);
    return;
  }
  await moveStage(row, "transcribing", { stage: "judge", transcript, error: null, available_at: new Date().toISOString() }, match);
}

/** AssemblyAI 웹훅 — 이 표의 전사면 처리하고 true(다른 표의 전사는 false로 넘긴다). */
export async function handleReviewTranscriptWebhook(transcriptId: string): Promise<boolean> {
  const { data, error } = await db().from("homework_video_reviews").select(REVIEW_COLUMNS).eq("transcript_id", transcriptId).maybeSingle();
  if (error) throw error;
  if (!data) return false;
  await applyTranscript(data as unknown as ReviewRow, await getTranscript(transcriptId));
  return true;
}

/**
 * 웹훅을 놓친 전사의 안전망 — 20분 넘게 돌아오지 않은 것을 직접 묻는다. 🔴 묻다가 실패(네트워크 등)하면 **그대로 둔다** —
 * 다시 맡기면 살아 있는 전사를 두고 새 유료 전사를 낸다(적대 리뷰 2026-10-20). 선점만 하고 번호를 못 받은 줄은 되돌린다.
 */
export async function reconcileTranscriptions(tenantId: string): Promise<number> {
  const before = new Date(Date.now() - 20 * 60_000).toISOString();
  const { data, error } = await db().from("homework_video_reviews").select(REVIEW_COLUMNS)
    .eq("tenant_id", tenantId).eq("stage", "transcribing").lt("updated_at", before).order("updated_at").limit(30);
  if (error) throw error;
  let done = 0;
  for (const row of (data ?? []) as unknown as ReviewRow[]) {
    if (!row.transcript_id) { await failOrRetry(row, "transcribe", "전사 요청이 끝나지 않아 다시 맡깁니다", 3, { transcript_id: null }); continue; }
    try { await applyTranscript(row, await getTranscript(row.transcript_id)); done++; }
    catch (e) { reportWarning("영상 메모 전사 확인 실패 — 다음에 다시 묻는다", { scope: "video-review.reconcile", id: row.id, error: errorText(e) }); }
  }
  return done;
}
