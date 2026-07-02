// 등록상담 녹음 전사 합본 — 순수 함수(웹훅·표시 공용, Vitest).
// 녹음이 여러 행(consultation_recordings)이라, 13섹션 AI 분석·폼 추출은
// "완료된 전체 녹음의 전사 합본"을 입력으로 받는다(녹음 1개면 레거시와 동일 포맷 = 프롬프트 무변).

export type SpeakerUtterance = { speaker: string; text: string };

export type RecordingTranscriptInput = {
  /** AssemblyAI 화자 분리 발화(없으면 null) */
  utterances: SpeakerUtterance[] | null;
  /** 통짜 전사 텍스트(화자 없을 때 폴백) */
  plainText: string | null;
  /** 녹음 행 created_at (ISO) — 다중 녹음 헤더 라벨용 */
  recordedAt: string;
};

const KST_LABEL = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 한 녹음의 전사를 화자 라벨 포함 텍스트로 — 레거시 웹훅 formatted와 동일 규칙. */
export function formatRecordingTranscript(rec: {
  utterances: SpeakerUtterance[] | null;
  plainText: string | null;
}): string {
  if (rec.utterances && rec.utterances.length > 0) {
    return rec.utterances.map((u) => `[화자 ${u.speaker}] ${u.text}`).join("\n");
  }
  return rec.plainText ?? "";
}

/**
 * 완료된 녹음들의 전사 합본.
 * - 1개: 헤더 없이 그대로(레거시 단일 녹음과 100% 동일 출력 — AI 프롬프트 무변).
 * - 2개+: 각 녹음 앞에 `《녹음 n · M/D HH:mm》` 헤더(시간순) — 상담 회차가 구분돼
 *   분석이 "여러 차례 상담"임을 인지한다. 빈 전사(둘 다 null/빈)는 건너뜀.
 * ⚠️ 화자 라벨(A/B)은 녹음마다 독립이라 다중 녹음에선 화자→역할 매핑을 신뢰하지 말 것
 *   (UI는 녹음 1개일 때만 speakerRoles 적용).
 */
export function combineConsultationTranscripts(recordings: RecordingTranscriptInput[]): string {
  const nonEmpty = recordings
    .map((r) => ({ ...r, formatted: formatRecordingTranscript(r) }))
    .filter((r) => r.formatted.trim().length > 0);
  if (nonEmpty.length === 0) return "";
  if (nonEmpty.length === 1) return nonEmpty[0].formatted;
  return nonEmpty
    .map((r, i) => {
      const when = Number.isNaN(new Date(r.recordedAt).getTime())
        ? ""
        : ` · ${KST_LABEL.format(new Date(r.recordedAt))}`;
      return `《녹음 ${i + 1}${when}》\n${r.formatted}`;
    })
    .join("\n\n");
}
