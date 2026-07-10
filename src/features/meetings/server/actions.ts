"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { submitTranscript } from "@/lib/ai/assemblyai";
import { localizeTranscriptionError } from "@/lib/ai/transcription-error";
import { getAssemblyaiWebhookUrl } from "@/lib/config/app-url";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isTenantAudioPath } from "@/lib/storage/audio-path";
import { resolveAudioUrl } from "@/lib/storage/legacy-audio";
import {
  getMediaBackend,
  removeObject,
  resolveAudioReadUrl,
  verifyUploadedObject,
} from "@/lib/storage/media-storage";
import { analyzeMeeting, formatMeetingTranscript } from "./ai";

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
  if (!(await canWriteTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

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

export type UpdateNotepadState = { error?: string; ok?: true; content?: string } | undefined;

/**
 * 회의 메모장(content) 저장 — 회의 중/후 직접 작성한 메모. AI 호출 없음(저장만).
 * 이 메모는 "AI로 정리" 시 전사와 **함께** 분석 입력이 된다(regenerateMeetingAnalysis·웹훅).
 * 저장한 content를 되돌려준다 — 클라가 이 값으로 dirty(수정됨) 여부를 파생(ref/effect 없이).
 */
export async function updateMeetingNotepad(
  _prev: UpdateNotepadState,
  formData: FormData,
): Promise<UpdateNotepadState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "회의록 ID가 누락되었습니다" };
  const content = String(formData.get("content") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.from("meeting_minutes").update({ content }).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath(`/meetings/${id}`);
  revalidatePath("/meetings");
  return { ok: true, content };
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
  if (!(await canWriteTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

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
  if (!(await canWriteTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

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
  if (!(await canWriteTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

  const title = String(formData.get("title") ?? "").trim();
  const heldAt = String(formData.get("heldAt") ?? "").trim();
  const audioPath = String(formData.get("audioPath") ?? "").trim();
  const audioSizeBytes = Number(formData.get("audioSizeBytes") ?? 0);
  // 메모장(선택) — 회의 중 작성한 메모. content에 저장돼 나중에 전사와 함께 분석된다.
  const notepad = String(formData.get("notepad") ?? "");
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

  // 2) 업로드 객체 검증(exists·size·contentType) 후 AssemblyAI가 fetch할 signed URL 생성.
  //    위반/부재면 객체 cleanup(GCS는 클라가 못 지움) 후 에러.
  let audioUrl: string;
  let verifiedSize = audioSizeBytes;
  try {
    const meta = await verifyUploadedObject("meeting", audioPath);
    if (meta.size > 0) verifiedSize = meta.size;
    audioUrl = await resolveAudioReadUrl(audioPath, "meeting", user.tenantId);
  } catch (e) {
    await removeObject(audioPath, { backend: getMediaBackend(), bucket: "meeting-recordings" }).catch(() => {});
    return { error: e instanceof Error ? e.message : "오디오 검증 실패" };
  }

  // 3) Create meeting row in uploaded state.
  const { data: meeting, error: insertErr } = await admin
    .from("meeting_minutes")
    .insert({
      tenant_id: user.tenantId,
      title,
      content: notepad,
      attendees,
      held_at: heldAt,
      author_id: user.id,
      audio_path: audioPath,
      audio_size_bytes: verifiedSize,
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
      })
      .eq("id", meeting.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const ko = localizeTranscriptionError(msg);
    await admin
      .from("meeting_minutes")
      .update({ processing_status: "failed", processing_error: ko })
      .eq("id", meeting.id);
    return { error: ko };
  }

  revalidatePath("/meetings");
  redirect(`/meetings/${meeting.id}`);
}

export type CreateTextMeetingState = { error?: string; id?: string } | undefined;

/**
 * 메모장만으로 회의록 생성(녹음 없음) — 회의 중 메모만 남겼거나 음성이 없을 때.
 * 성공 시 새 id를 반환(클라가 상세로 이동) — 거기서 "AI로 정리"로 8섹션 분석(메모 기반). AI 호출은 명시 트리거라 여기선 안 함.
 * ⚠️ redirect() 미사용 — 클라 프로그램 호출이라 반환값으로 네비(창/스탠드얼론 분기를 호출부가 결정).
 */
export async function createTextMeeting(
  _prev: CreateTextMeetingState,
  formData: FormData,
): Promise<CreateTextMeetingState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

  const title = String(formData.get("title") ?? "").trim();
  const heldAt = String(formData.get("heldAt") ?? "").trim();
  const content = String(formData.get("notepad") ?? "");
  const attendees = String(formData.get("attendees") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!title) return { error: "제목을 입력해주세요" };
  if (!heldAt) return { error: "회의 일시를 입력해주세요" };
  if (!content.trim()) return { error: "메모 내용을 입력해주세요" };

  const admin = createAdminClient();
  const { data: meeting, error } = await admin
    .from("meeting_minutes")
    .insert({
      tenant_id: user.tenantId,
      title,
      content,
      attendees,
      held_at: heldAt,
      author_id: user.id,
      processing_status: "idle",
    })
    .select("id")
    .single();
  if (error || !meeting) return { error: `회의록 생성 실패: ${error?.message ?? "unknown"}` };

  revalidatePath("/meetings");
  return { id: meeting.id as string };
}

export type DeleteMeetingState = { error?: string } | undefined;

/** 회의록 삭제 — row + (있으면) Storage 음성파일 동시 제거. */
export async function deleteMeeting(
  _prev: DeleteMeetingState,
  formData: FormData,
): Promise<DeleteMeetingState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

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

  // 1) Storage 음성파일 제거(있으면) — 현 백엔드(GCS/Supabase)로. 레거시(옛 ijw) 경로는 공유라 미삭제.
  if (m.audio_path && isTenantAudioPath(m.audio_path, user.tenantId)) {
    await removeObject(m.audio_path, { backend: getMediaBackend(), bucket: "meeting-recordings" }).catch(() => {});
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
  if (!(await canWriteTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

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
 * 텍스트 기반 "AI로 정리 / 다시 생성" — 저장된 **전사 + 메모장(content)**으로 8섹션을 (재)생성한다.
 * ⭐ 오디오·AssemblyAI·웹훅 불필요(in-process generateJSON) → 원본 녹음이 삭제돼도 동작하고,
 * 로컬에서도 즉시 완주한다. ("전사부터 다시"=retryMeetingProcessing 과 의미 분리.)
 * 전사·메모장 중 하나만 있어도 동작(메모만 작성한 회의도 정리 가능).
 */
export async function regenerateMeetingAnalysis(
  _prev: RegenerateMeetingState,
  formData: FormData,
): Promise<RegenerateMeetingState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "meetings"))) return { error: "회의록 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "회의록 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: m } = await supabase
    .from("meeting_minutes")
    .select("id, title, attendees, held_at, transcription, speaker_labels, content")
    .eq("id", id)
    .single();
  if (!m) return { error: "회의록을 찾을 수 없습니다" };
  const transcription = String(m.transcription ?? "").trim();
  const notepad = String(m.content ?? "").trim();
  if (!transcription && !notepad) {
    return { error: "전사나 메모가 있어야 AI로 정리할 수 있습니다" };
  }

  const attendees = Array.isArray(m.attendees) ? (m.attendees as string[]) : [];
  const heldAt = new Date(m.held_at).toLocaleDateString("ko-KR");
  // 전사가 있으면 화자 포맷, 없으면 빈 문자열(메모만 분석). analyzeMeeting이 둘을 결합.
  const formatted = transcription ? formatMeetingTranscript(m.transcription as string, m.speaker_labels) : "";
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
        notepad,
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
