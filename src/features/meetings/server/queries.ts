import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { humanizeDbError } from "@/lib/supabase/db-error";
import {
  ilikeTerm,
  inMeetingRange,
  matchMeetingStatus,
  matchMeetingText,
  type MeetingRangeKey,
  type MeetingStatusKey,
} from "../list-filter";

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
  // 카드 미리보기는 excerpt(140자 컷)를 line-clamp-2로 보여주고, 요약 전문은 hover title로 노출.
  // AI 요약이 있을 때만(전사/노트 폴백은 길어 벽이 됨 → title 미부여).
  summaryFull: string | null;
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
  aiReportEditedBy: string | null; // AI 보고서 섹션 마지막 수정자
  aiReportEditedAt: string | null;
  aiModelVersion: string | null; // 분석 생성 모델 id(표시용 라벨 재료)
  aiSpeakerRoles: Record<string, string> | null;
  speakerStaff: Record<string, string> | null;
  aiGeneratedAt: string | null;
};

function excerpt(content: string, max = 140): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max) + "…";
}

export type MeetingListParams = {
  range: MeetingRangeKey;
  status: MeetingStatusKey;
  q: string;
  page: number;
  pageSize: number;
};

export type MeetingListResult =
  | {
      ok: true;
      rows: MeetingRow[];
      total: number;
      counts: { all: number; completed: number; inProgress: number };
    }
  | { ok: false; error: string; raw?: string };

type LightMeeting = {
  id: string;
  title: string;
  ai_summary: string | null;
  attendees: unknown;
  held_at: string;
  processing_status: string;
  audio_path: string | null;
  author: { display_name?: string } | { display_name?: string }[] | null;
};

/**
 * 회의록 목록 한 페이지(T6·N8, 2026-09-23 감사).
 *
 * 예전 getMeetings는 **모든 회의의 전사 원문**까지 받아(1000건에서 잘림 + 회의가 쌓일수록 느림) 메모리에서 걸렀고,
 * 조회 실패는 "회의 없음"으로 보였다. 지금은
 *  ① 가벼운 칸(전사·메모 제외)만 `fetchAllPaged`로 끝까지 받아 기간·상태·검색(제목·참석자·AI 요약)을 거르고
 *  ② 검색어가 있으면 전사 원문은 DB ilike로 id만 찾아 합치고
 *  ③ 페이지에 선 행 중 **AI 요약이 없는 행만** 전사·메모를 따로 받아 미리보기를 만든다(최대 pageSize개).
 * 실패는 `{ ok:false }`로 돌려 화면이 한글 배너를 띄운다(빈 목록으로 위장하지 않는다).
 */
export async function getMeetingsPage(params: MeetingListParams): Promise<MeetingListResult> {
  const supabase = await createClient();
  const term = ilikeTerm(params.q);
  try {
    const [light, transcriptHits] = await Promise.all([
      fetchAllPaged<LightMeeting>((from, to) =>
        supabase
          .from("meeting_minutes")
          .select(
            `id, title, ai_summary, attendees, held_at, processing_status, audio_path,
             author:author_id ( display_name )`,
          )
          .order("held_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      ),
      // 전사 원문 검색 — 원문은 내려받지 않고 id만(B2: 끝까지 페이징).
      term
        ? fetchAllPaged<{ id: string }>((from, to) =>
            supabase
              .from("meeting_minutes")
              .select("id")
              .ilike("transcription", `%${term}%`)
              .order("id", { ascending: true })
              .range(from, to),
          )
        : Promise.resolve([] as { id: string }[]),
    ]);
    const transcriptIds = new Set(transcriptHits.map((r) => r.id));

    const all = light.map((r) => ({
      raw: r,
      attendees: normalizeAttendees(r.attendees),
      status: r.processing_status as MeetingProcessingStatus,
    }));
    const counts = {
      all: all.length,
      completed: all.filter((m) => m.status === "completed").length,
      inProgress: all.filter((m) => m.status === "transcribing" || m.status === "analyzing").length,
    };
    const filtered = all.filter(
      (m) =>
        (params.q.trim() === "" ||
          transcriptIds.has(m.raw.id) ||
          matchMeetingText({ title: m.raw.title, attendees: m.attendees, aiSummary: m.raw.ai_summary }, params.q)) &&
        inMeetingRange(m.raw.held_at, params.range) &&
        matchMeetingStatus(m.status, params.status),
    );
    const pageRows = filtered.slice((params.page - 1) * params.pageSize, params.page * params.pageSize);

    // 요약 없는 행만 전사·메모를 받아 미리보기로(페이지 크기 이하 — 단일 .in으로 충분하지만 규약대로 청크).
    const needBody = pageRows.filter((m) => !m.raw.ai_summary).map((m) => m.raw.id);
    const bodies = needBody.length
      ? await fetchInChunks<{ id: string; transcription: string | null; content: string | null }>(needBody, (chunk) =>
          supabase.from("meeting_minutes").select("id, transcription, content").in("id", chunk),
        )
      : [];
    const bodyById = new Map(bodies.map((b) => [b.id, b]));

    const rows: MeetingRow[] = pageRows.map((m) => {
      const r = m.raw;
      const author = (Array.isArray(r.author) ? r.author[0] : r.author) as { display_name?: string } | null | undefined;
      const b = bodyById.get(r.id);
      // 미리보기는 AI 요약 우선 — 전사 raw가 아니라 회의 핵심이 행에 보이게(요약 없으면 전사/노트 폴백).
      const body = r.ai_summary ?? b?.transcription ?? b?.content ?? "";
      const summaryNorm = r.ai_summary ? r.ai_summary.trim().replace(/\s+/g, " ") : null;
      return {
        id: r.id,
        title: r.title,
        heldAt: r.held_at,
        attendees: m.attendees,
        authorName: author?.display_name ?? null,
        excerpt: excerpt(body),
        summaryFull: summaryNorm && summaryNorm.length > 140 ? summaryNorm : null,
        processingStatus: m.status,
        hasAudio: !!r.audio_path,
      };
    });
    return { ok: true, rows, total: filtered.length, counts };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { ok: false, error: humanizeDbError(raw, "조회"), raw };
  }
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
       ai_summary, ai_action_items, ai_report, ai_report_edited_by, ai_report_edited_at,
       ai_speaker_roles, speaker_staff, ai_generated_at, ai_model_version,
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
    summaryFull: null, // 상세에선 미사용(목록 카드 hover 전용)
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
    aiReportEditedBy: data.ai_report_edited_by ?? null,
    aiReportEditedAt: data.ai_report_edited_at ?? null,
    aiModelVersion: (data.ai_model_version as string | null) ?? null,
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
