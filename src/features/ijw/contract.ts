/**
 * 인재원 학습 프로그램(MemoType, D:\anki-main) **읽기 API 계약** — 순수 모듈(Vitest로 잠금).
 *
 * 사용자 2026-09-10: 영어 단어시험·평소 학습 데이터는 인재원이 갖고 있고 eywa는 **필요할 때 요청**한다(pull).
 * 설명서 = `D:\anki-main\memotype\docs\EYWA-API.md`(v1). 여기엔 DB를 안 만지는 부분만 둔다 — 응답 모양 검사,
 * 한글 표기 도우미, 오류 문구. 서버 호출은 `server/client.ts`, 기간 정리는 `range.ts`.
 *
 * ⚠️ 날짜 규칙이 둘이다(설명서 ①): **시험 = KST 달력 날짜**, **학습 = 학습일(KST 03:00 경계)**. 섞으면 하루가 밀린다.
 * ⚠️ 학생 짝은 `ijwId`(바뀌지 않는 키), 화면 이름은 `name`(인재원에서 바뀔 수 있다).
 * 🔴 숫자 칸은 **엄격하게** 읽는다 — 이름이 바뀐 칸을 0으로 채우면 화면이 "0분"을 그럴듯하게 그리고 아무도
 *    눈치채지 못한다(적대 리뷰 2026-09-10). 어긋나면 `bad_response`("형식이 바뀌었을 수 있습니다")로 떨어진다.
 */
import { z } from "zod";

/** 필수 숫자 — 문자열 숫자("20")는 받되, 칸이 빠지거나 숫자가 아니면 실패(NaN은 zod가 거절한다). */
const num = z.coerce.number();
const str = z.string().catch("");
/** 없을 수 있는 숫자(설명서: 해당자가 없으면 null) — null은 받되 칸이 **빠지면** 실패. */
const nullableNum = z.number().nullable();

const Student = z.object({ ijwId: z.string(), name: str, className: z.string().nullable().catch(null) });
const StudentRef = z.object({ id: z.string(), name: str, className: z.string().nullable().catch(null) });
const Deck = z.object({ id: z.string(), name: str, examType: str });

const ExamListItem = z.object({
  attemptId: z.string(),
  deckId: z.string(),
  deck: str,
  examType: str,
  submittedAt: str,
  total: num,
  correct: num,
  score: num,
});

const ExamResult = z.object({
  student: StudentRef,
  deck: Deck,
  submittedAt: str,
  elapsedMs: num,
  total: num,
  correct: num,
  score: num,
  classAvg: nullableNum,
  overallAvg: nullableNum,
  byPos: z.array(z.object({ pos: str, label: str, correct: num, total: num })),
  wrong: z.array(z.object({ prompt: str, answer: str, typed: str })),
});

const Study = z.object({
  student: StudentRef,
  from: str,
  to: str,
  totals: z.object({
    answers: num,
    correct: num,
    accuracy: num,
    studyMs: num,
    newWords: num,
    activeDays: num,
  }),
  longTermWords: num,
  seenWords: num,
  daily: z.array(z.object({ day: str, answers: num, correct: num, studyMs: num })),
  byDeck: z.array(z.object({ deckId: str, deck: str, answers: num, correct: num })),
  byPos: z.array(z.object({ pos: str, label: str, answers: num, correct: num })),
  weak: z.array(z.object({ prompt: str, answer: str, wrongs: num, answers: num })),
  exams: z.array(ExamListItem),
});

const ExamSummary = z.object({
  deckId: z.string(),
  name: str,
  examType: str,
  takers: num,
  avg: nullableNum,
  max: nullableNum,
  min: nullableNum,
  lastSubmittedAt: str,
});

const DeckResult = z.object({
  ijwId: z.string(),
  name: str,
  className: z.string().nullable().catch(null),
  attemptId: z.string(),
  submittedAt: str,
  total: num,
  correct: num,
  score: num,
  elapsedMs: num,
});

const StudySummaryRow = z.object({
  ijwId: z.string(),
  name: str,
  className: z.string().nullable().catch(null),
  answers: num,
  correct: num,
  accuracy: num,
  studyMs: num,
  activeDays: num,
  newWords: num,
  longTermWords: num,
  seenWords: num,
});

/** 모든 성공 응답은 `v: 1`로 시작한다(설명서 ③). 다른 버전이면 모양이 바뀐 것이라 읽지 않는다. */
const v1 = <T extends z.ZodRawShape>(shape: T) => z.object({ v: z.literal(1), ...shape });

export const IJW_SCHEMAS = {
  students: v1({ students: z.array(Student) }),
  studentExams: v1({ exams: z.array(ExamListItem) }),
  examResult: v1({}).merge(ExamResult),
  study: v1({}).merge(Study),
  examSummary: v1({ exams: z.array(ExamSummary) }),
  deckResults: v1({ deck: Deck, results: z.array(DeckResult) }),
  studySummary: v1({ from: str, to: str, students: z.array(StudySummaryRow) }),
} as const;

export type IjwStudent = z.infer<typeof Student>;
export type IjwExamListItem = z.infer<typeof ExamListItem>;
export type IjwExamResult = z.infer<typeof ExamResult>;
export type IjwStudy = z.infer<typeof Study>;
export type IjwExamSummary = z.infer<typeof ExamSummary>;
export type IjwDeckResult = z.infer<typeof DeckResult>;
export type IjwStudySummaryRow = z.infer<typeof StudySummaryRow>;

/** 호출 실패의 종류 — 화면 문구가 원인을 단정하지 않도록 나눈다(eywa 설정 없음 ≠ 인재원 설정 없음 ≠ 서버 꺼짐 ≠ 키 틀림). */
export type IjwFailKind =
  | "not_configured"
  | "remote_not_configured"
  | "unauthorized"
  | "not_found"
  | "bad_request"
  | "unreachable"
  | "bad_response"
  | "server"
  | "local";

export const IJW_FAIL_TEXT: Record<IjwFailKind, string> = {
  not_configured: "이 학원에는 인재원 학습 프로그램 연동이 설정되지 않았습니다.",
  remote_not_configured: "인재원 서버에 연동 열쇠가 아직 들어가 있지 않습니다(인재원 쪽 설정).",
  unauthorized: "인재원 연동 열쇠가 맞지 않습니다 — 양쪽 설정을 확인해 주세요.",
  not_found: "인재원에서 해당 학생이나 시험을 찾지 못했습니다.",
  bad_request: "인재원이 요청을 받지 않았습니다 — 기간을 확인해 주세요.",
  unreachable: "인재원 서버에 연결하지 못했습니다. 잠시 후 다시 열어 주세요.",
  bad_response: "인재원 응답을 읽지 못했습니다(형식이 바뀌었을 수 있습니다).",
  server: "인재원 서버에서 오류가 났습니다. 잠시 후 다시 열어 주세요.",
  local: "eywa에서 학생 연결 정보를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.",
};

/**
 * HTTP 상태 → 실패 종류(설명서 ②). 🔴 503을 무조건 '설정 안 됨'으로 읽지 않는다 — eywa 쪽 설정이 없을 때와
 * 같은 문장이 떠 어느 쪽을 고쳐야 할지 몰랐다. 인재원이 "키 미설정"이라고 말할 때만 인재원 쪽 설정으로 본다.
 */
export function failKindOfStatus(status: number, bodyError = ""): IjwFailKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 400) return "bad_request";
  if (status === 503) return /키|미설정|not.?configured/i.test(bodyError) ? "remote_not_configured" : "server";
  return "server";
}

/**
 * 화면 문장 — 400은 인재원이 적어 준 한국어 문장("날짜 형식이…")이 원인을 가장 잘 말해서 그대로 쓴다.
 * 한글이 없는 원문(영문 코드)은 화면에 내지 않는다(raw 노출 금지 — 원문은 detail 툴팁으로만).
 */
export function ijwFailMessage(kind: IjwFailKind, bodyError = ""): string {
  const said = bodyError.trim();
  if (kind === "bad_request" && /[가-힣]/.test(said)) return said.slice(0, 120);
  return IJW_FAIL_TEXT[kind];
}

/** `regular` 평시 / `exam` 내신 — 모르는 값은 '기타'(평시로 뭉개면 새 구분이 조용히 평시가 된다). */
export function examTypeLabel(examType: string): string {
  if (examType === "exam") return "내신";
  if (examType === "regular") return "평시";
  return "기타";
}

/**
 * 점수 묶음 요약 — **인재원과 같은 반올림**(평균은 정수, 설명서 6번 `avg: 73` = 85·80·55의 평균).
 * 시험 목록(인재원 계산)과 결과 창 머리(여기서 계산)가 같은 시험에 73 · 73.3처럼 다른 평균을 말하지 않게.
 */
export function summarizeScores(scores: readonly number[]): {
  count: number;
  avg: number | null;
  max: number | null;
  min: number | null;
} {
  const xs = scores.filter((n) => Number.isFinite(n));
  if (xs.length === 0) return { count: 0, avg: null, max: null, min: null };
  return {
    count: xs.length,
    avg: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length),
    max: Math.max(...xs),
    min: Math.min(...xs),
  };
}

/** 걸린 시간 — 3시간이 넘으면 `—`(테스트 계정의 5일짜리 이상값, 설명서 '필드 뜻'). */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0 || ms > 3 * 3600_000) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}초`;
  return `${Math.floor(s / 60)}분 ${s % 60}초`;
}

/** 학습 시간(답안 하나 최대 30초로 자른 합) — 분·시간으로. 몇 초라도 했으면 0분으로 적지 않는다. */
export function formatStudyTime(ms: number): string {
  const n = Number.isFinite(ms) ? ms : 0;
  const m = Math.round(n / 60000);
  if (m < 1) return n > 0 ? "1분 미만" : "0분";
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}
