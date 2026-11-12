/**
 * 화면에 내리는 모양 — 서버(server/view.ts)가 만들고 재생 창 패널(components/ai-review-panel.tsx)이 그린다.
 * 영어 단계 이름·모델 원문은 내리지 않는다(한글 상태 + 모델 친화 라벨만, CLAUDE.md 'raw 코드 노출 금지').
 */
import { cleanTeacherList, cleanTeacherNote, cleanTeacherText } from "./harness/teacher-text";
import { SCORE_KEYS, type ReviewOverall, type ReviewResult, type ReviewStage, type ScoreKey } from "./types";

/** 화면에 내리는 결과 — 전사 보정표(원 전사 문구가 들어 있다)는 빼고 건수만(원장 "외부로 나가는 건 분석 결과만", 적대 리뷰 2026-10-20). */
export type ReviewResultView = Omit<ReviewResult, "transcriptFixes"> & { transcriptFixCount: number };

export function toResultView(r: ReviewResult): ReviewResultView {
  const { transcriptFixes, ...rest } = r;
  // 선생님이 읽을 말로(teacher-text.ts) — 작업 용어·화면 파일 이름·음성 인식 이야기를 걷는다. 저장값은 그대로 두고 화면에 내릴 때만.
  return {
    ...rest,
    topic: cleanTeacherText(r.topic),
    note: cleanTeacherNote(r.note),
    scores: Object.fromEntries(SCORE_KEYS.map((k) => [k, { score: r.scores[k].score, evidence: cleanTeacherText(r.scores[k].evidence) }])) as ReviewResult["scores"],
    // 확인 단계가 '확정'한 오류는 지우지 않는다 — 문구만 다듬는다(적대 리뷰 2026-10-21: 오류 설명에 '전사'가 들면 오류째 사라졌다).
    mistakes: r.mistakes.map((m) => ({ where: cleanTeacherText(m.where), seen: cleanTeacherText(m.seen), whyWrong: cleanTeacherText(m.whyWrong) })),
    needsCheck: cleanTeacherList(r.needsCheck),
    selfFixed: cleanTeacherList(r.selfFixed),
    transcriptFixCount: transcriptFixes.length,
  };
}

export type ReviewViewState = "waiting" | "analyzing" | "done" | "failed" | "skipped";

export type ReviewView = {
  state: ReviewViewState;
  /** 상태 한 줄(한글) — '오늘 밤 분석 예정' 등. */
  message: string;
  /** 지난 결과(다시 분석 중에도 이전 결과를 보여 준다). */
  result: ReviewResultView | null;
  judgeModelLabel: string | null;
  canRerun: boolean;
};

export const OVERALL_LABEL: Record<ReviewOverall, string> = { good: "잘함", fair: "보통", needs_work: "보완 필요" };
export const OVERALL_TONE = { good: "positive", fair: "info", needs_work: "caution" } as const;
export const SCORE_LABEL: Record<ScoreKey, string> = {
  accuracy: "정확성", order: "순서", reasoning: "이유 설명", terms: "용어", delivery: "전달력",
};

/** 전사까지 끝나 다시 분석할 수 있는 단계. AI 분석이 꺼졌으면 버튼 자체를 내리지 않는다. */
export const RUNNABLE_NOW = ["judge", "done", "failed"] as const;
export function canRerunReview(stage: ReviewStage, hasTranscript: boolean, hasAssets: boolean, aiEnabled: boolean): boolean {
  return aiEnabled && (RUNNABLE_NOW as readonly string[]).includes(stage) && hasTranscript && hasAssets;
}

/** 단계 → 화면 상태와 한 줄(순수). `error`는 실패 사유 원문이 아니라 한글 요약만 쓴다. */
export function stageView(stage: ReviewStage, hasResult: boolean): { state: ReviewViewState; message: string } {
  switch (stage) {
    case "extract": return { state: "waiting", message: "영상을 준비하고 있어요(소리·화면 추출 대기)." };
    case "transcribe":
    case "transcribing": return { state: "waiting", message: "말소리를 글로 옮기고 있어요." };
    case "judge": return { state: "waiting", message: hasResult ? "다시 분석을 기다리고 있어요." : "오늘 밤에 분석해요. 내일 아침에 확인해 주세요." };
    case "judging":
    case "verify":
    case "verifying": return { state: "analyzing", message: "분석하고 있어요." };
    case "done": return { state: "done", message: "" };
    case "skipped": return { state: "skipped", message: "말소리가 거의 없어 분석하지 않았어요." };
    case "failed": return { state: "failed", message: "분석하지 못했어요. 영상 파일을 열 수 없거나 여러 번 실패했어요." };
  }
}
