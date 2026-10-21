import "server-only";
import { assertTenantViewOutboundAllowed } from "@/lib/auth/tenant-view-outbound";

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

/**
 * 전사 요청에 싣는 모델 목록 — **한국어를 실제로 지원하는 모델만** 넣는다.
 *
 * ⚠️ 한국어는 `universal-2`(99개 언어)에만 있다. 상위 모델 `universal-3-pro`(2026-02)·
 * `universal-3.5-pro`는 18개 언어(영·스·불·독·이·포·아랍·덴마크·네덜란드·핀란드·히브리·힌디·
 * 일본어·중국어·노르웨이·스웨덴·터키·베트남)만 지원하고 **한국어가 빠져 있다.**
 *
 * 새 모델을 여기 추가하기 전에 지원 언어표에서 `ko`를 **직접 확인**할 것 — 미지원 모델은
 * 에러 없이 무시되고 뒤 모델로 폴백한다(= 조용한 무효과). 가드는 `assemblyai-models.test.ts`.
 * https://www.assemblyai.com/docs/pre-recorded-audio/supported-languages
 */
export const KOREAN_SPEECH_MODELS = ["universal-2"] as const;

export type AssemblySubmitResult = {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
};

export async function submitTranscript(args: {
  audioUrl: string;
  webhookUrl?: string;
  webhookAuthHeader?: { name: string; value: string };
  /**
   * 어휘 강조 — 기본은 회의 어휘(`MEETING_WORD_BOOST`). `null`이면 보내지 않는다(영상 설명 AI 참고 메모는 강조 없이 시험해
   * 하네스를 맞췄다 — 2026-10-20, 수학 용어는 전사 뒤 코드 사전이 고친다).
   */
  wordBoost?: readonly string[] | null;
  /** 화자 구분(기본 켬). 학생 혼자 말하는 영상은 끈다. */
  speakerLabels?: boolean;
}): Promise<AssemblySubmitResult> {
  // 운영 콘솔의 '지점 보기'(읽기 전용) 중에는 바깥으로 내보내지 않는다(tenant-view-outbound.ts) — 요청 밖(cron · 웹훅)에서는 늘 통과한다.
  await assertTenantViewOutboundAllowed();
  const body: Record<string, unknown> = {
    audio_url: args.audioUrl,
    language_code: "ko",
    speaker_labels: args.speakerLabels ?? true,
    // AssemblyAI가 단수 `speech_model`을 폐기(400 거부) → 다중모델 배열로 보낸다.
    // 🔴 2026-08-06까지 `["universal-3-pro", "universal-2"]`를 보내며 주석엔 "pro 우선"이라
    // 적어뒀는데, pro는 한국어 미지원이라 **실제 전사 전건이 universal-2로 조용히 폴백**하고
    // 있었다(응답 `speech_model_used` 실측 확인). 착각만 남기므로 상위 모델은 빼둔다.
    speech_models: KOREAN_SPEECH_MODELS,
    ...(args.wordBoost === null ? {} : { word_boost: args.wordBoost ?? MEETING_WORD_BOOST, boost_param: "high" }),
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
  /** 단어별 시각(ms) — 영상 설명 AI 참고 메모의 시각별 전사·멈춤 계산에 쓴다. */
  words?: { start: number; text: string }[] | null;
  /** 실제로 쓰인 모델(요청값이 아니라 응답값 — 막힌 점 #96). */
  speech_model_used?: string | null;
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
