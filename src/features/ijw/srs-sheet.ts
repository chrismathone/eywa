/**
 * 인재원 **SRS 결과지**(원장 2026-09-28 *"srs에 있는 결과지 이거 자체를 받아서 넣을 수도 있음?"* → 방식 2 "SRS 모양을 aywa가 그대로")
 * — 인재원의 캔버스 결과지(`public/ijw/exam-report.js`, 인재원 `server/web/exam-report.js`를 **그대로 복사**)에 넘길 데이터를
 * 만든다. 순수 모듈(Vitest로 잠금).
 *
 * 🔑 그리는 코드는 인재원 것 한 벌이다 — 여기서 모양을 다시 만들지 않는다(두 벌이면 인재원 화면과 학부모가 받은 결과지가 어긋난다).
 *    인재원이 모양을 바꾸면 그 파일을 다시 복사한다(로고 경로 두 곳만 다르다 — `"/ijw/logo.svg?v=4"`).
 * 🔑 넘기는 모양 = 인재원 관리자 화면의 `examRepDataOf`(admin.html)와 같다.
 * 🔴 **문항 목록(`items`)이 없으면 null** — 인재원이 문항을 주기 전 응답·옛 동결본은 aywa 결과지(jj-exam-sheet)로 그린다.
 *    문항 없이 그리면 문항별 결과·구간별 정답률이 빈 칸으로 학부모에게 나간다.
 * 🔴 학생 이름은 **aywa 이름**을 쓴다 — 인재원 이름은 대개 로그인 아이디(`ijwgsy`)라 학부모 문서에 그대로 나가면 안 된다.
 */
import type { IjwExamResult } from "./contract";

/** 결과지 칸 — 인재원 `SECTIONS` 키. 기본은 전부 켠다(원장 2026-09-28 "SRS 기본값, 모든 칸"). */
export const SRS_SECTIONS = ["rank", "grid", "radar", "causes", "blocks", "time", "wrong"] as const;
export type SrsSection = (typeof SRS_SECTIONS)[number];

export type SrsItem = {
  no: number;
  prompt: string;
  answer: string;
  typed: string;
  correct: boolean;
  choice?: boolean;
  answered?: boolean;
  ms?: number;
};

export type SrsSheetData = {
  attemptId?: string;
  studentName: string;
  userId: string;
  className: string;
  deckName: string;
  submittedAt: string;
  elapsedMs: number;
  correct: number;
  total: number;
  pct: number;
  classAvg: number | null;
  classCount: number | null;
  allAvg: number | null;
  allCount: number | null;
  rank: { rank: number; total: number; classRank?: number; classTotal?: number } | null;
  items: SrsItem[];
};

const finiteOrNull = (n: number | null | undefined): number | null => (n != null && Number.isFinite(n) ? n : null);

/** 응시 한 건 → 인재원 결과지 데이터. 문항 목록이 없으면 null(aywa 결과지로 그린다). */
export function srsSheetDataOf(exam: IjwExamResult, studentName?: string | null): SrsSheetData | null {
  const items = exam.items;
  if (!items || items.length === 0) return null;
  const overall = exam.rank?.overall ?? null;
  const cls = exam.rank?.class ?? null;
  return {
    attemptId: exam.attemptId,
    studentName: studentName?.trim() || exam.student.name || "학생",
    userId: exam.student.id,
    className: exam.student.className ?? "",
    deckName: exam.deck.name || "시험",
    submittedAt: exam.submittedAt,
    elapsedMs: exam.elapsedMs,
    correct: exam.correct,
    total: exam.total,
    pct: exam.score,
    classAvg: finiteOrNull(exam.classAvg),
    classCount: finiteOrNull(exam.classCount),
    allAvg: finiteOrNull(exam.overallAvg),
    allCount: finiteOrNull(exam.overallCount),
    // 전체 등수가 없으면(테스트 계정·재응시 전 옛 결과) 등수 칸을 그리지 않는다 — 반 등수만 따로 그리는 칸이 인재원엔 없다.
    rank: overall
      ? {
          rank: overall.rank,
          total: overall.of,
          ...(cls ? { classRank: cls.rank, classTotal: cls.of } : {}),
        }
      : null,
    items: items.map((q, i) => ({
      no: q.no != null && Number.isFinite(q.no) ? q.no : i + 1,
      prompt: q.prompt,
      answer: q.answer,
      typed: q.typed,
      correct: q.correct === true,
      ...(typeof q.choice === "boolean" ? { choice: q.choice } : {}),
      ...(typeof q.answered === "boolean" ? { answered: q.answered } : {}),
      ...(q.ms != null && Number.isFinite(q.ms) ? { ms: q.ms } : {}),
    })),
  };
}
