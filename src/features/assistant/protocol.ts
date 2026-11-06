/**
 * 학원 비서 서버 ↔ 화면 약속(순수 타입·상수).
 *
 * - `POST /api/assistant/ask` 본문 `AskBody` → 응답은 **한 줄에 JSON 하나**(NDJSON, `application/x-ndjson`) 흐름 `AskEvent`.
 *   마지막 줄은 늘 `report` 또는 `error`다. 연결이 끊기면 화면은 `GET /api/assistant/threads/[id]`로 다시 읽는다(서버는 끝까지 돌고 저장한다).
 * - `GET /api/assistant/threads` → `ThreadListResponse` · `GET /api/assistant/threads/[id]` → `ThreadDetailResponse` ·
 *   `DELETE /api/assistant/threads/[id]` → `{ ok: true }`.
 * 오류 응답(JSON)은 `{ error: string }`(한국어) + 상태 코드.
 */
import type { AssistantLevel } from "./levels";
import type { SettledReport } from "./report";

export type AskBody = { threadId?: string | null; question: string; level: AssistantLevel };

/**
 * 진행 단계 — 원장 2026-11-06 *"진짜 Ai 대화하는것처럼 어떤 db를 조회중이고 어떤 프로그레스중인지 단계가 표시되면 좋을듯"*.
 * 같은 `id`의 단계가 여러 번 온다(running → done/error, 그 사이 label·tables·detail이 바뀐다) — 화면은 id로 덮어쓴다.
 */
export type StepKind =
  /** 질문을 읽는 중(첫 차례) */
  | "understand"
  /** 쓸 표를 고르고 구조를 보는 중 */
  | "schema"
  /** AI가 조회문을 쓰는 중(목적이 보이면 label에 붙는다) */
  | "write_sql"
  /** 조회 실행 */
  | "query"
  /** 결과를 살펴보는 중(다음 차례) */
  | "analyze"
  /** 보고서 · 비서 의견 작성 */
  | "report"
  /** 보고서를 고쳐 다시 내는 중 */
  | "fix";
export type StepTable = { name: string; label: string };
export type AskStep = {
  id: string;
  kind: StepKind;
  /** 한국어 한 줄(예: "조회 2 · 반별 미납액"). */
  label: string;
  state: "running" | "done" | "error";
  /** 이 단계가 보는 DB 표(짧은 이름 칩). */
  tables?: StepTable[];
  /** 끝난 뒤 한 줄(예: "12행 · 0.3초") 또는 실패 까닭(한국어). */
  detail?: string;
  /** 질문을 받은 때부터 이 단계가 시작된 시각(ms) · 걸린 시간(ms). */
  at: number;
  ms?: number;
};

export type AskEvent =
  /**
   * 늘 첫 줄 — 이 질문의 번호. 화면의 '멈춤'은 이 번호로 `POST /api/assistant/messages/[id]/stop`을 보낸다(연결만 끊으면 서버는 끝까지 돈다).
   * 이 줄이 오기 전에 누른 '멈춤'은 이 줄을 받자마자 보낸다(use-assistant · 적대 리뷰 2026-11-06).
   */
  | { type: "started"; messageId: string }
  /** 새 대화를 만들었을 때(started 다음 줄). */
  | { type: "thread"; threadId: string; title: string }
  /** 진행 단계(같은 id는 덮어쓴다). */
  | { type: "step"; step: AskStep }
  | { type: "report"; messageId: string; report: SettledReport }
  | { type: "error"; message: string; messageId?: string };

export type ThreadSummary = { id: string; title: string; level: AssistantLevel; updatedAt: string };
export type ThreadListResponse = { enabled: boolean; threads: ThreadSummary[] };

export type QuerySummary = { id: string; purpose: string; rowCount: number; ms: number; error?: string };
export type ThreadMessage = {
  id: string;
  question: string;
  level: AssistantLevel;
  createdAt: string;
  /** 끝난 답(없으면 실패했거나 아직 도는 중). */
  report: SettledReport | null;
  error: string | null;
  /** 아직 도는 중(다른 창에서 물은 질문 등). */
  running: boolean;
  queries: QuerySummary[];
  /** 답을 만든 과정(다시 열면 '과정 보기'로 펼친다). */
  steps: AskStep[];
};
export type ThreadDetailResponse = { thread: ThreadSummary; messages: ThreadMessage[] };

/** 질문 한 편의 최대 길이. */
export const ASSISTANT_QUESTION_MAX = 2000;

/**
 * '도는 중'으로 보는 시간 — 서버는 `ASSISTANT_HARD_DEADLINE_MS`에 스스로 끊고 저장하므로 이보다 오래 '도는 중'인 줄은 함수가 죽어 남은 것이다.
 * 화면의 다시 읽기(polling)도 이 시간까지 잇는다.
 */
export const ASSISTANT_RUNNING_MS = 5 * 60_000;
/** 서버가 질문을 스스로 끊는 시각(라우트 기한 300초 안 — 남은 시간에 저장·감사 기록을 마친다). */
export const ASSISTANT_HARD_DEADLINE_MS = 250_000;

/** 처음 열었을 때 보여 줄 추천 질문. */
export const ASSISTANT_SUGGESTIONS: readonly string[] = [
  "이번 달 신규·퇴원 추이를 지난 6개월과 비교해 줘",
  "미납 현황을 반별로 정리해 줘",
  "최근 2주 결석이 늘어난 원생은?",
  "강사별 이번 달 수업보고서 작성률",
  "과목·학년별 재원생 구성",
  "이번 달 지출을 분류별로 보여 줘",
];
