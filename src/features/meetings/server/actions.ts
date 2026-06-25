"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { generateJSON } from "@/lib/ai/generate";
import { submitTranscript } from "@/lib/ai/assemblyai";
import { getAssemblyaiWebhookUrl } from "@/lib/config/app-url";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isTenantAudioPath } from "@/lib/storage/audio-path";
import { resolveAudioUrl } from "@/lib/storage/legacy-audio";
import { analyzeMeeting, formatMeetingTranscript } from "./ai";

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
  // 역할 게이트 — 유료 AI 호출은 회의록 접근권이 있는 역할만(비용통제, #S5 형제). RLS는 데이터만 막는다.
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "meetings"))) {
    return { error: "회의록 권한이 없습니다" };
  }

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
  let modelVersion: string;
  try {
    const { data, model } = await generateJSON<AnalysisShape>({
      maxTokens: 2048,
      prompt: [
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
    });
    analysis = data;
    modelVersion = model;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `AI 호출 실패: ${msg}` };
  }

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
export type UpdateMeetingTitleState = { error?: string; ok?: true } | undefined;

/** 회의록 제목 인라인 수정. */
export async function updateMeetingTitle(
  _prev: UpdateMeetingTitleState,
  formData: FormData,
): Promise<UpdateMeetingTitleState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  if (!id) return { error: "회의록 ID가 누락되었습니다" };
  if (!title) return { error: "제목을 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase.from("meeting_minutes").update({ title }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/meetings/${id}`);
  revalidatePath("/meetings");
  return { ok: true };
}

export type UpdateReportSectionState =
  | { error?: string; ok?: true; editedBy?: string; editedAt?: string }
  | undefined;

// 인라인 수정 가능한 8섹션(meetingType 제외) — staff가 인쇄/공유 전 AI 오류를 교정.
const EDITABLE_REPORT_KEYS = new Set([
  "summary",
  "agendaDiscussion",
  "decisions",
  "actionItems",
  "speakerSummary",
  "concerns",
  "nextSteps",
]);

/** 회의 AI 보고서 섹션 본문 인라인 수정 — 해당 섹션만 ai_report jsonb에 머지 + 마지막 수정자·시각 기록. */
export async function updateMeetingReportSection(
  _prev: UpdateReportSectionState,
  formData: FormData,
): Promise<UpdateReportSectionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const key = String(formData.get("key") ?? "").trim();
  const content = String(formData.get("content") ?? "");
  if (!id) return { error: "회의록 ID가 누락되었습니다" };
  if (!EDITABLE_REPORT_KEYS.has(key)) return { error: "잘못된 섹션입니다" };

  const supabase = await createClient();
  // 현재 ai_report를 읽어 해당 섹션만 머지(다른 섹션 보존).
  const { data: row } = await supabase
    .from("meeting_minutes")
    .select("ai_report")
    .eq("id", id)
    .single();
  if (!row) return { error: "회의록을 찾을 수 없습니다" };
  const report =
    row.ai_report && typeof row.ai_report === "object"
      ? (row.ai_report as Record<string, unknown>)
      : {};
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("meeting_minutes")
    .update({
      ai_report: { ...report, [key]: content.trim() },
      ai_report_edited_by: user.displayName,
      ai_report_edited_at: now,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/meetings/${id}`);
  revalidatePath("/meetings");
  return { ok: true, editedBy: user.displayName, editedAt: now };
}

export type UpdateMeetingSpeakersState = { error?: string; ok?: true } | undefined;

/**
 * 화자(A/B/C) → 표시 라벨 + 직원(staffId) 수동 매핑. 화자 편집 UI에서 직원 드롭다운 선택 시 저장.
 * `ai_speaker_roles`(표시 라벨 맵) + `speaker_staff`(연계용 staffId 맵)를 함께 갱신한다.
 * payload(JSON): `{ "A": { "label": "김원장", "staffId": "<uuid>"|null }, ... }`
 */
export async function updateMeetingSpeakers(
  _prev: UpdateMeetingSpeakersState,
  formData: FormData,
): Promise<UpdateMeetingSpeakersState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "회의록 ID가 누락되었습니다" };

  let mapping: Record<string, { label?: string; staffId?: string | null }>;
  try {
    mapping = JSON.parse(String(formData.get("mapping") ?? "{}"));
  } catch {
    return { error: "화자 정보 형식이 올바르지 않습니다" };
  }

  const roles: Record<string, string> = {};
  const staff: Record<string, string> = {};
  for (const [speaker, v] of Object.entries(mapping)) {
    const label = (v?.label ?? "").trim();
    if (label) roles[speaker] = label;
    if (v?.staffId) staff[speaker] = v.staffId;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("meeting_minutes")
    .update({
      ai_speaker_roles: Object.keys(roles).length ? roles : null,
      speaker_staff: Object.keys(staff).length ? staff : null,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/meetings/${id}`);
  return { ok: true };
}

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

  // 1) Verify the path is a single object key under this tenant (#S4 — prefix만 보던 것 강화).
  if (!isTenantAudioPath(audioPath, user.tenantId)) {
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
  const webhookUrl = getAssemblyaiWebhookUrl();

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

export type DeleteMeetingState = { error?: string } | undefined;

/** 회의록 삭제 — row + (있으면) Storage 음성파일 동시 제거. */
export async function deleteMeeting(
  _prev: DeleteMeetingState,
  formData: FormData,
): Promise<DeleteMeetingState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const redirectTo = String(formData.get("redirectTo") ?? "").trim();
  if (!id) return { error: "회의록 ID가 누락되었습니다" };

  const supabase = await createClient();
  // RLS가 테넌트 스코프를 보장 — 같은 테넌트 회의록만 조회/삭제된다.
  const { data: m } = await supabase
    .from("meeting_minutes")
    .select("id, audio_path")
    .eq("id", id)
    .single();
  if (!m) return { error: "회의록을 찾을 수 없습니다" };

  // 1) Storage 음성파일 제거(있으면) — admin 클라이언트로(스토리지는 RLS 밖).
  if (m.audio_path && isTenantAudioPath(m.audio_path, user.tenantId)) {
    const admin = createAdminClient();
    await admin.storage.from("meeting-recordings").remove([m.audio_path]);
  }

  // 2) row 삭제 (RLS 스코프).
  const { error } = await supabase.from("meeting_minutes").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/meetings");
  if (redirectTo) redirect(redirectTo);
  return undefined;
}

export type RetryMeetingState = { error?: string } | undefined;

/**
 * 멈춘/실패한 음성 회의록 재처리 — 원본 audio_path로 AssemblyAI 재제출 후 transcribing 리셋.
 * 네트워크/큐 문제로 failed에 갇힌 건을 새로 업로드 없이 복구.
 */
export async function retryMeetingProcessing(
  _prev: RetryMeetingState,
  formData: FormData,
): Promise<RetryMeetingState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "회의록 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: m } = await supabase
    .from("meeting_minutes")
    .select("id, audio_path, processing_status")
    .eq("id", id)
    .single();
  if (!m) return { error: "회의록을 찾을 수 없습니다" };
  if (!m.audio_path) {
    return { error: "재처리할 음성 파일이 없습니다 ('AI 분석 다시 생성'은 전사 텍스트만으로 가능)" };
  }

  // 신규(Supabase) 경로면 Supabase, 옛 ijw(Firebase Storage) 경로면 Firebase signed URL을 만든다.
  // throw는 반드시 {error}로 — 보존만료로 파일 삭제 시 명확한 한글 메시지가 UI에 뜬다.
  let audioUrl: string;
  try {
    audioUrl = await resolveAudioUrl(m.audio_path, "meeting", user.tenantId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "오디오 URL 생성 실패" };
  }

  const admin = createAdminClient();
  const webhookUrl = getAssemblyaiWebhookUrl();

  try {
    const result = await submitTranscript({
      audioUrl,
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
        processing_error: null,
      })
      .eq("id", id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `재제출 실패: ${msg}` };
  }

  revalidatePath(`/meetings/${id}`);
  revalidatePath("/meetings");
  return undefined;
}

export type RegenerateMeetingState = { error?: string } | undefined;

/**
 * 텍스트 기반 "AI 분석 다시 생성" — 저장된 transcription으로 8섹션을 재생성한다.
 * ⭐ 오디오·AssemblyAI·웹훅 불필요(in-process generateJSON) → 원본 녹음이 삭제돼도 동작하고,
 * 로컬에서도 즉시 완주한다. ("전사부터 다시"=retryMeetingProcessing 과 의미 분리.)
 */
export async function regenerateMeetingAnalysis(
  _prev: RegenerateMeetingState,
  formData: FormData,
): Promise<RegenerateMeetingState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "회의록 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: m } = await supabase
    .from("meeting_minutes")
    .select("id, title, attendees, held_at, transcription, speaker_labels")
    .eq("id", id)
    .single();
  if (!m) return { error: "회의록을 찾을 수 없습니다" };
  if (!m.transcription || String(m.transcription).trim().length === 0) {
    return { error: "전사 내용이 없어 AI 분석을 생성할 수 없습니다" };
  }

  const attendees = Array.isArray(m.attendees) ? (m.attendees as string[]) : [];
  const heldAt = new Date(m.held_at).toLocaleDateString("ko-KR");
  const formatted = formatMeetingTranscript(m.transcription, m.speaker_labels);
  const admin = createAdminClient();

  // 즉시 analyzing으로 표시 → 페이지가 음성 분석과 동일한 '분석 중' 스켈레톤 + StatusWatcher 폴링을 띄운다.
  await admin
    .from("meeting_minutes")
    .update({ processing_status: "analyzing", processing_error: null })
    .eq("id", id);
  revalidatePath(`/meetings/${id}`);

  // 분석은 백그라운드(after)로 — 응답을 즉시 반환해 진행 UI가 바로 뜨고, 완료/실패 시 watcher가 자동 새로고침.
  // 갱신 필드는 웹훅의 회의 완료 저장과 동일(상태/UI 일관).
  after(async () => {
    try {
      const { report, speakerRoles, model } = await analyzeMeeting(formatted, {
        title: m.title,
        heldAt,
        attendees,
      });
      await admin
        .from("meeting_minutes")
        .update({
          ai_report: report,
          ai_summary: report.summary,
          ai_speaker_roles: speakerRoles,
          ai_model_version: model,
          ai_generated_at: new Date().toISOString(),
          processing_status: "completed",
          processing_error: null,
        })
        .eq("id", id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI 분석 생성 실패";
      await admin
        .from("meeting_minutes")
        .update({ processing_status: "failed", processing_error: `AI 분석 실패: ${msg}` })
        .eq("id", id);
    }
  });

  return undefined;
}
