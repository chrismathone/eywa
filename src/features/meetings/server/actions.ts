"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CLAUDE_MODELS, getAnthropic } from "@/lib/ai/anthropic";
import { submitTranscript } from "@/lib/ai/assemblyai";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type ActionItem = {
  action: string;
  assignee?: string;
  due?: string;
};

type AnalysisShape = {
  summary: string;
  actionItems: ActionItem[];
};

export type MeetingAiState = { error?: string } | undefined;

/**
 * Legacy text-only flow: takes the `content` text already saved, runs Claude
 * for summary + action items. Kept for manually-typed meetings.
 */
export async function runMeetingAiAnalysis(
  _prev: MeetingAiState,
  formData: FormData,
): Promise<MeetingAiState> {
  const meetingId = String(formData.get("meetingId") ?? "");
  if (!meetingId) return { error: "회의록 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: m } = await supabase
    .from("meeting_minutes")
    .select("id, title, content, attendees, held_at")
    .eq("id", meetingId)
    .single();

  if (!m) return { error: "회의록을 찾을 수 없습니다" };

  const attendees = Array.isArray(m.attendees) ? (m.attendees as string[]).join(", ") : "미상";
  const heldAt = new Date(m.held_at).toLocaleDateString("ko-KR");

  let analysis: AnalysisShape;
  try {
    const client = getAnthropic();
    const response = await client.messages.create({
      model: CLAUDE_MODELS.balanced,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            "다음 학원 회의록을 분석해 JSON으로만 답해주세요.",
            "",
            `제목: ${m.title}`,
            `일시: ${heldAt}`,
            `참석자: ${attendees}`,
            "",
            "본문:",
            m.content,
            "",
            "JSON schema:",
            "{",
            '  "summary": string (2-3문장의 한국어 TLDR),',
            '  "actionItems": [{ "action": string, "assignee"?: string, "due"?: string }]',
            "}",
            "",
            "actionItems의 due는 명시되어 있으면 YYYY-MM-DD 또는 자유 텍스트, 명시 안 됐으면 생략.",
            "assignee는 회의록에 명시된 담당자(예: 박지훈 강사 → 박지훈)만. 추측하지 말 것.",
            "",
            "JSON만 출력. 마크다운 코드 블록 없이.",
          ].join("\n"),
        },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    analysis = JSON.parse(cleaned) as AnalysisShape;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `AI 호출 실패: ${msg}` };
  }

  const modelVersion = CLAUDE_MODELS.balanced;

  const { error } = await supabase
    .from("meeting_minutes")
    .update({
      ai_summary: analysis.summary,
      ai_action_items: analysis.actionItems,
      ai_model_version: modelVersion,
      ai_generated_at: new Date().toISOString(),
    })
    .eq("id", meetingId);

  if (error) return { error: error.message };

  revalidatePath(`/meetings/${meetingId}`);
  revalidatePath("/meetings");
  return undefined;
}

/**
 * Audio flow: client already uploaded the file to storage. Server creates the
 * meeting row, gets a signed URL, submits to AssemblyAI with a webhook callback,
 * then redirects to the detail page. The webhook does the rest (transcript fetch
 * + Claude analysis).
 */
export type StartMeetingFromAudioInput = {
  title: string;
  attendees: string[];
  heldAt: string; // ISO timestamp
  audioPath: string; // {tenant_id}/{uuid}.{ext} — already in meeting-recordings bucket
  audioSizeBytes: number;
};

export type StartMeetingFromAudioState = { error?: string } | undefined;

export async function startMeetingFromAudio(
  _prev: StartMeetingFromAudioState,
  formData: FormData,
): Promise<StartMeetingFromAudioState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const title = String(formData.get("title") ?? "").trim();
  const heldAt = String(formData.get("heldAt") ?? "").trim();
  const audioPath = String(formData.get("audioPath") ?? "").trim();
  const audioSizeBytes = Number(formData.get("audioSizeBytes") ?? 0);
  const attendeesRaw = String(formData.get("attendees") ?? "");
  const attendees = attendeesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!title) return { error: "제목을 입력해주세요" };
  if (!heldAt) return { error: "회의 일시를 입력해주세요" };
  if (!audioPath) return { error: "음성 파일이 누락되었습니다" };

  const admin = createAdminClient();

  // 1) Verify the storage object exists and belongs to this tenant.
  const expectedPrefix = `${user.tenantId}/`;
  if (!audioPath.startsWith(expectedPrefix)) {
    return { error: "파일 경로가 잘못되었습니다" };
  }

  // 2) Generate a signed URL AssemblyAI can fetch (long enough for queue + DL).
  const { data: signed, error: signErr } = await admin.storage
    .from("meeting-recordings")
    .createSignedUrl(audioPath, 60 * 60); // 1 hour
  if (signErr || !signed?.signedUrl) {
    return { error: `signed URL 생성 실패: ${signErr?.message ?? "unknown"}` };
  }

  // 3) Create meeting row in uploaded state.
  const { data: meeting, error: insertErr } = await admin
    .from("meeting_minutes")
    .insert({
      tenant_id: user.tenantId,
      title,
      content: "",
      attendees,
      held_at: heldAt,
      author_id: user.id,
      audio_path: audioPath,
      audio_size_bytes: audioSizeBytes,
      processing_status: "uploaded",
    })
    .select("id")
    .single();

  if (insertErr || !meeting) {
    return { error: `회의록 생성 실패: ${insertErr?.message ?? "unknown"}` };
  }

  // 4) Submit to AssemblyAI with webhook callback.
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://eywa-alpha.vercel.app");
  const webhookUrl = `${appUrl}/api/webhooks/assemblyai`;

  try {
    const result = await submitTranscript({
      audioUrl: signed.signedUrl,
      webhookUrl,
      webhookAuthHeader: process.env.ASSEMBLYAI_WEBHOOK_SECRET
        ? { name: "x-eywa-webhook-secret", value: process.env.ASSEMBLYAI_WEBHOOK_SECRET }
        : undefined,
    });

    await admin
      .from("meeting_minutes")
      .update({
        assemblyai_transcript_id: result.id,
        processing_status: "transcribing",
      })
      .eq("id", meeting.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin
      .from("meeting_minutes")
      .update({ processing_status: "failed", processing_error: `AssemblyAI 제출 실패: ${msg}` })
      .eq("id", meeting.id);
    return { error: msg };
  }

  revalidatePath("/meetings");
  redirect(`/meetings/${meeting.id}`);
}
