import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * attendees(jsonb) 정규화 (F2). 라이브 앱은 string[]로, ijw 임포터는 [{name}] 객체로 저장해
 * 모양이 갈린다. 두 모양(문자열 · {name})을 모두 string[]로 흡수해 "[object Object]" 렌더를 막는다.
 */
function normalizeAttendees(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) =>
      typeof a === "string"
        ? a
        : a && typeof a === "object" && "name" in a
          ? String((a as { name: unknown }).name ?? "")
          : "",
    )
    .filter((s) => s.trim().length > 0);
}

export type MeetingProcessingStatus =
  | "idle"
  | "uploaded"
  | "transcribing"
  | "analyzing"
  | "completed"
  | "failed";

export type MeetingRow = {
  id: string;
  title: string;
  heldAt: string;
  attendees: string[];
  authorName: string | null;
  excerpt: string;
  processingStatus: MeetingProcessingStatus;
  hasAudio: boolean;
};

export type MeetingActionItem = {
  action: string;
  assignee?: string;
  due?: string;
};

export type SpeakerUtterance = {
  speaker: string;
  text: string;
  start: number;
  end: number;
};

export type MeetingReportSection = {
  meetingType: string;
  summary: string;
  agendaDiscussion: string;
  decisions: string;
  actionItems: string;
  speakerSummary: string;
  concerns: string;
  nextSteps: string;
};

export type MeetingDetail = MeetingRow & {
  content: string;
  transcription: string | null;
  speakerLabels: SpeakerUtterance[] | null;
  processingError: string | null;
  audioPath: string | null;
  audioDurationSec: number | null;
  aiSummary: string | null;
  aiActionItems: MeetingActionItem[] | null;
  aiReport: MeetingReportSection | null;
  aiSpeakerRoles: Record<string, string> | null;
  speakerStaff: Record<string, string> | null;
  aiGeneratedAt: string | null;
};

function excerpt(content: string, max = 140): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max) + "…";
}

export async function getMeetings(): Promise<MeetingRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("meeting_minutes")
    .select(
      `id, title, content, transcription, ai_summary, attendees, held_at,
       processing_status, audio_path,
       author:author_id ( display_name )`,
    )
    .order("held_at", { ascending: false });

  if (!data) return [];

  return data.map((r) => {
    const author = (Array.isArray(r.author) ? r.author[0] : r.author) as
      | { display_name?: string }
      | undefined;
    // 미리보기는 AI 요약 우선 — 전사 raw가 아니라 회의 핵심이 카드에 보이게(요약 없으면 전사/노트 폴백).
    const body = r.ai_summary ?? r.transcription ?? r.content ?? "";
    return {
      id: r.id,
      title: r.title,
      heldAt: r.held_at,
      attendees: normalizeAttendees(r.attendees),
      authorName: author?.display_name ?? null,
      excerpt: excerpt(body),
      processingStatus: r.processing_status as MeetingProcessingStatus,
      hasAudio: !!r.audio_path,
    };
  });
}

export type StaffOption = { id: string; name: string; jobTitle: string | null };

/** 화자→직원 매핑 드롭다운용 경량 직원 목록(활성). 단일 테넌트 ≤1000행이라 절단 위험 없음. */
export async function getStaffOptions(): Promise<StaffOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, display_name, job_title")
    .neq("status", "inactive")
    .order("display_name", { ascending: true });
  return (data ?? []).map((u) => ({
    id: u.id,
    name: u.display_name ?? "(이름 없음)",
    jobTitle: u.job_title ?? null,
  }));
}

export async function getMeetingById(id: string): Promise<MeetingDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("meeting_minutes")
    .select(
      `id, title, content, attendees, held_at,
       audio_path, audio_duration_sec, transcription, speaker_labels,
       processing_status, processing_error,
       ai_summary, ai_action_items, ai_report, ai_speaker_roles, speaker_staff, ai_generated_at,
       author:author_id ( display_name )`,
    )
    .eq("id", id)
    .single();

  if (!data) return null;

  const author = (Array.isArray(data.author) ? data.author[0] : data.author) as
    | { display_name?: string }
    | undefined;

  const body = data.transcription ?? data.content ?? "";

  return {
    id: data.id,
    title: data.title,
    heldAt: data.held_at,
    attendees: normalizeAttendees(data.attendees),
    authorName: author?.display_name ?? null,
    excerpt: excerpt(body),
    content: data.content,
    transcription: data.transcription,
    speakerLabels: Array.isArray(data.speaker_labels)
      ? (data.speaker_labels as SpeakerUtterance[])
      : null,
    processingStatus: data.processing_status as MeetingProcessingStatus,
    processingError: data.processing_error,
    audioPath: data.audio_path,
    audioDurationSec: data.audio_duration_sec,
    hasAudio: !!data.audio_path,
    aiSummary: data.ai_summary,
    aiActionItems: Array.isArray(data.ai_action_items)
      ? (data.ai_action_items as MeetingActionItem[])
      : null,
    aiReport:
      data.ai_report && typeof data.ai_report === "object"
        ? (data.ai_report as MeetingReportSection)
        : null,
    aiSpeakerRoles:
      data.ai_speaker_roles && typeof data.ai_speaker_roles === "object"
        ? (data.ai_speaker_roles as Record<string, string>)
        : null,
    speakerStaff:
      data.speaker_staff && typeof data.speaker_staff === "object"
        ? (data.speaker_staff as Record<string, string>)
        : null,
    aiGeneratedAt: data.ai_generated_at,
  };
}
