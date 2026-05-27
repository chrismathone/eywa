import "server-only";

/**
 * Lightweight AssemblyAI v2 client. Wraps just the calls we need for the
 * meeting-minutes pipeline — submit transcript with webhook + fetch result.
 *
 * Reference: https://www.assemblyai.com/docs/api-reference/transcripts
 */

const API_BASE = "https://api.assemblyai.com/v2";

function authHeaders() {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error("ASSEMBLYAI_API_KEY missing");
  return { Authorization: key, "Content-Type": "application/json" };
}

// Korean academy domain vocabulary — boosts AssemblyAI accuracy on recurring terms.
// Mirrors the list from ijw-calander/functions/index.js MEETING_WORD_BOOST.
export const MEETING_WORD_BOOST = [
  // Academy core
  "학원",
  "원장",
  "강사",
  "선생님",
  "수업",
  "교실",
  "교재",
  "시간표",
  "출결",
  "결석",
  "지각",
  "보강",
  "수강료",
  "정기시험",
  "내신",
  "모의고사",
  "수능",
  "특강",
  // Subjects / grades
  "수학",
  "영어",
  "국어",
  "과학",
  "사회",
  "중1",
  "중2",
  "중3",
  "고1",
  "고2",
  "고3",
  // Meeting-specific
  "회의",
  "안건",
  "발표",
  "논의",
  "결정",
  "합의",
  "투표",
  "찬성",
  "반대",
  "보류",
  "제안",
  "건의",
  "보고",
  "예산",
  "실적",
  "매출",
  "목표",
  "달성률",
  "인사",
  "채용",
  "퇴사",
  "승진",
  "발령",
  "공지",
  "전달",
];

export type AssemblySubmitResult = {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
};

export async function submitTranscript(args: {
  audioUrl: string;
  webhookUrl?: string;
  webhookAuthHeader?: { name: string; value: string };
}): Promise<AssemblySubmitResult> {
  const body: Record<string, unknown> = {
    audio_url: args.audioUrl,
    language_code: "ko",
    speaker_labels: true,
    speech_model: "universal",
    word_boost: MEETING_WORD_BOOST,
    boost_param: "high",
  };
  if (args.webhookUrl) {
    body.webhook_url = args.webhookUrl;
    if (args.webhookAuthHeader) {
      body.webhook_auth_header_name = args.webhookAuthHeader.name;
      body.webhook_auth_header_value = args.webhookAuthHeader.value;
    }
  }

  const res = await fetch(`${API_BASE}/transcript`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AssemblyAI submit failed (${res.status}): ${text}`);
  }
  return (await res.json()) as AssemblySubmitResult;
}

export type SpeakerUtterance = {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
};

export type AssemblyTranscript = {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  text: string | null;
  audio_duration: number | null;
  utterances: SpeakerUtterance[] | null;
  error: string | null;
};

export async function getTranscript(id: string): Promise<AssemblyTranscript> {
  const res = await fetch(`${API_BASE}/transcript/${id}`, {
    headers: { Authorization: process.env.ASSEMBLYAI_API_KEY ?? "" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AssemblyAI getTranscript failed (${res.status}): ${text}`);
  }
  return (await res.json()) as AssemblyTranscript;
}
